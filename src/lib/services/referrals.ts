import { adminQuery } from "../db";
import { firstName } from "../domain/text";
import { sendSystemMail } from "../systemMail";
import { SITE } from "../site";
import { appUrl } from "./core";

// Referrals. An agency shares /waitlist?ref=CODE. The person joins the waitlist (status "waiting"), signs up when
// invited ("signed_up"), and 60 days later, if the new agency is still using 8gency, the referrer earns a free month
// ("qualified"), up to six a year. Free months are recorded as credits to take off a bill once billing is live.

export const QUALIFY_AFTER_DAYS = 60;
export const MAX_FREE_MONTHS_PER_YEAR = 6;

const cleanCode = (c: string | null | undefined) => (c ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);

/** Someone joined the waitlist from a referral link. Unknown codes and the agency's own email are ignored. */
export async function noteWaitlistReferral(email: string, agencyName: string, code: string | null | undefined) {
  const c = cleanCode(code);
  if (!c) return;
  const [ref] = await adminQuery<{ id: string }>("select id from agencies where referral_code = $1", [c]);
  if (!ref) return;
  const own = await adminQuery("select 1 from users where agency_id = $1 and lower(email) = lower($2)", [ref.id, email]);
  if (own.length) return;
  await adminQuery(
    "insert into referrals (referrer_agency_id, referred_email, referred_agency_name) values ($1,$2,$3) on conflict (lower(referred_email)) do nothing",
    [ref.id, email, agencyName.slice(0, 80)],
  );
}

/** Daily: grant a free month for each referral whose agency has stayed 60 days. Returns how many were granted. */
export async function qualifyReferrals() {
  const due = await adminQuery<{ id: string; referrer: string; name: string }>(
    `select r.id, r.referrer_agency_id as referrer, r.referred_agency_name as name from referrals r
      where r.status = 'signed_up' and r.signed_up_at <= now() - make_interval(days => $1)
        and exists (select 1 from users u where u.agency_id = r.referred_agency_id and u.active and not u.is_sample)`,
    [QUALIFY_AFTER_DAYS],
  );
  let granted = 0;
  for (const r of due) {
    const [{ n }] = await adminQuery<{ n: number }>("select count(*)::int as n from agency_credits where agency_id = $1 and referral_id is not null and created_at > now() - interval '365 days'", [r.referrer]);
    const capped = n >= MAX_FREE_MONTHS_PER_YEAR;
    // Done in one statement so a retry can't grant it twice.
    const won = await adminQuery("update referrals set status = $2, qualified_at = now() where id = $1 and status = 'signed_up' returning 1", [r.id, capped ? "void" : "qualified"]);
    if (!won.length || capped) continue;
    await adminQuery("insert into agency_credits (agency_id, referral_id, months, reason) values ($1,$2,1,$3)", [r.referrer, r.id, `Referred ${r.name}, who stayed ${QUALIFY_AFTER_DAYS} days`]);
    granted++;
    const owners = await adminQuery<{ name: string; email: string }>("select name, email from users where agency_id = $1 and role = 'owner' and active and not is_sample", [r.referrer]);
    for (const o of owners) {
      await sendSystemMail({
        to: o.email,
        subject: `You've earned a free month: ${r.name} stayed ${QUALIFY_AFTER_DAYS} days`,
        text: `Hi ${firstName(o.name)},\n\n${r.name}, who joined through your link, has now been using 8gency for ${QUALIFY_AFTER_DAYS} days. That earns your agency a free month, taken off a future bill.\n\nSee your referrals: ${appUrl("/app/settings?tab=referrals")}\n\nThank you for spreading the word.\n\n8gency`,
      }).catch((e) => console.error("referral email failed", (e as Error).message));
    }
  }
  return granted;
}

export async function referralSummary(agencyId: string) {
  const [{ referral_code }] = await adminQuery<{ referral_code: string }>("select referral_code from agencies where id = $1", [agencyId]);
  const rows = await adminQuery<{ id: string; referred_agency_name: string; status: string; created_at: Date; signed_up_at: Date | null; qualified_at: Date | null }>(
    "select id, referred_agency_name, status, created_at, signed_up_at, qualified_at from referrals where referrer_agency_id = $1 order by created_at desc",
    [agencyId],
  );
  const [credits] = await adminQuery<{ earned: number; used: number }>("select coalesce(sum(months), 0)::int as earned, coalesce(sum(months) filter (where applied_at is not null), 0)::int as used from agency_credits where agency_id = $1", [agencyId]);
  return { code: referral_code, link: `${SITE.url}/waitlist?ref=${referral_code}`, rows, earned: credits.earned, used: credits.used };
}

import { adminQuery, withTenant, type Tx } from "../db";
import { addDays, formatShort, startOfWeek, todayIn } from "../domain/dates";
import { formatMoney } from "../domain/money";
import { firstName } from "../domain/text";
import { sendSystemMail } from "../systemMail";
import { agencySettings, appUrl } from "./core";
import { fixList, type Fix } from "./fixes";
import { bookingsBetween } from "./bookings";

// The weekly rhythm. The owner gets one email on Monday morning (from 8gency, it's
// account email) with money brought in, money still leaking and the three biggest
// fixes; the same numbers sit on Pulse as "This week". On Friday afternoon anyone
// with a gap in their timesheet gets one nudge. Both run from the scheduler.

export interface WeekSummary {
  from: string;
  to: string;
  /** Invoices issued in the last seven days. */
  billed: number;
  /** Invoices paid in the last seven days. */
  collected: number;
  /** What the one-click fixes could still recover. */
  leaking: number;
  fixes: Fix[];
  fixCount: number;
  jobsDue: { id: string; label: string; due_date: string }[];
  /** Hours booked on people this week. */
  bookedHours: number;
}

/** Pass the fix list in when the caller already has it. */
export async function weekSummary(tx: Tx, known?: Fix[]): Promise<WeekSummary> {
  const today = todayIn((await agencySettings(tx)).timezone);
  const from = addDays(today, -7);
  const week = startOfWeek(today);
  const money = (await tx.one<{ billed: string; collected: string }>(
    `select coalesce(sum(total_cents) filter (where status in ('sent','paid') and issue_date > $1), 0) as billed,
            coalesce(sum(paid_cents) filter (where paid_at > now() - interval '7 days'), 0) as collected
       from invoices where status <> 'void'`,
    [from],
  ))!;
  const fixes = known ?? (await fixList(tx));
  return {
    from,
    to: today,
    billed: Number(money.billed),
    collected: Number(money.collected),
    leaking: fixes.reduce((s, f) => s + (f.cents ?? 0), 0),
    fixes: fixes.slice(0, 3),
    fixCount: fixes.length,
    jobsDue: await tx.q<{ id: string; label: string; due_date: string }>(
      "select id, number || ' ' || name as label, due_date::text from jobs where status not in ('closed','complete') and due_date between $1 and $2 order by due_date limit 6",
      [week, addDays(week, 6)],
    ),
    bookedHours: (await bookingsBetween(tx, week, addDays(week, 6))).reduce((s, b) => s + b.hours, 0),
  };
}

const localHour = (tz: string, now: Date) => Number(now.toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: tz })) % 24;
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export function weeklyEmailText(name: string, agency: string, w: WeekSummary) {
  const fixes = w.fixes.length
    ? w.fixes.map((f, i) => `${i + 1}. ${f.title}${f.cents ? ` (${formatMoney(f.cents)})` : ""}\n   ${f.detail}`).join("\n")
    : "Nothing to fix right now. Well done.";
  return `Hi ${firstName(name)},\n\nYour week at ${agency}, ${formatShort(w.from)} to ${formatShort(w.to)}:\n\n• Billed: ${formatMoney(w.billed)}\n• Collected: ${formatMoney(w.collected)}\n• Still leaking: ${formatMoney(w.leaking)}${w.fixCount ? ` across ${w.fixCount} thing${w.fixCount === 1 ? "" : "s"} you can fix` : ""}\n\nThe biggest ${w.fixes.length === 1 ? "one" : `${w.fixes.length}`}:\n${fixes}\n\nFix them in one click: ${appUrl("/app/pulse")}\n\nTo stop this email, turn it off on your account page: ${appUrl("/app/account")}\n\n8gency`;
}

/** Monday from 07:00 agency time, once per owner. */
export async function sendWeeklyEmails(now = new Date()) {
  const owners = await adminQuery<{ id: string; name: string; email: string; agency_id: string; agency: string; timezone: string; sent_on: string | null }>(
    `select u.id, u.name, u.email, u.agency_id, a.name as agency, a.timezone, u.weekly_email_sent_on::text as sent_on
       from users u join agencies a on a.id = u.agency_id
      where u.active and u.role = 'owner' and u.weekly_email and not u.is_sample`,
  );
  let sent = 0;
  for (const o of owners) {
    const today = todayIn(o.timezone, now);
    if (weekday(today) !== 1 || localHour(o.timezone, now) < 7 || o.sent_on === today) continue;
    try {
      const w = await withTenant({ agencyId: o.agency_id, actorLabel: "automation" }, weekSummary);
      if (w.billed || w.collected || w.fixCount) {
        await sendSystemMail({ to: o.email, subject: w.leaking ? `${o.agency}: ${formatMoney(w.leaking, "ZAR", { compact: true })} still to recover this week` : `${o.agency}: your week`, text: weeklyEmailText(o.name, o.agency, w) });
        sent++;
      }
      await adminQuery("update users set weekly_email_sent_on = $2 where id = $1", [o.id, today]);
    } catch (e) {
      console.error(`weekly email to ${o.id} failed`, (e as Error).message);
    }
  }
  return sent;
}

/** Friday from 15:00 agency time: anyone who logs time, and has a weekday with none this week, gets one reminder. */
export async function sendTimesheetReminders(now = new Date()) {
  const people = await adminQuery<{ id: string; name: string; email: string; agency_id: string; timezone: string; reminded_on: string | null }>(
    `select u.id, u.name, u.email, u.agency_id, a.timezone, u.timesheet_reminded_on::text as reminded_on
       from users u join agencies a on a.id = u.agency_id
      where u.active and u.timesheet_reminders and not u.is_sample and u.email not like '%.invalid'
        and exists (select 1 from time_entries te where te.user_id = u.id and te.work_date > current_date - 30)`,
  );
  let sent = 0;
  for (const p of people) {
    const today = todayIn(p.timezone, now);
    if (weekday(today) !== 5 || localHour(p.timezone, now) < 15 || p.reminded_on === today) continue;
    const week = startOfWeek(today);
    const [{ missing }] = await adminQuery<{ missing: number }>(
      `select (5 - count(distinct work_date) filter (where extract(isodow from work_date) < 6))::int as missing
         from time_entries where user_id = $1 and work_date between $2 and $3`,
      [p.id, week, today],
    );
    try {
      if (missing > 0) {
        await sendSystemMail({
          to: p.email,
          subject: "Your timesheet has gaps this week",
          text: `Hi ${firstName(p.name)},\n\n${missing === 1 ? "One weekday has" : `${missing} weekdays have`} no time logged this week. It takes a couple of minutes: your suggestions are ready to confirm.\n\n${appUrl("/app/time")}\n\nTo stop these reminders, turn them off on your account page: ${appUrl("/app/account")}\n\n8gency`,
        });
        await withTenant({ agencyId: p.agency_id, userId: p.id, actorLabel: "automation" }, (tx) =>
          tx.q("insert into notifications (agency_id, user_id, kind, title, body, href, dedupe_key) values ($1,$2,'timesheet','Your timesheet has gaps','Confirm the week before it closes.','/app/time',$3) on conflict do nothing", [tx.agencyId, p.id, `timesheet:${week}`]),
        );
        sent++;
      }
      await adminQuery("update users set timesheet_reminded_on = $2 where id = $1", [p.id, today]);
    } catch (e) {
      console.error(`timesheet reminder to ${p.id} failed`, (e as Error).message);
    }
  }
  return sent;
}

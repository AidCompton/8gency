import { adminQuery } from "./db";

// Usage counts: which feature was used, and who was active, per day. Counts only, never content (see the privacy policy).
// Written with the admin connection because it happens outside a tenant transaction; failures are swallowed so counting
// can never break what someone is doing.

const feature = (path: string) => path.split("?")[0].split("/").filter(Boolean).slice(1, 2)[0] ?? "home";

/** A successful action on a page counts as one use of that part of the product. */
export async function recordUse(agencyId: string, backPath: string) {
  try {
    await adminQuery(
      "insert into usage_days (agency_id, day, feature, n) values ($1, current_date, $2, 1) on conflict (agency_id, day, feature) do update set n = usage_days.n + 1",
      [agencyId, feature(backPath).slice(0, 40)],
    );
  } catch {}
}

/** This person opened the app today. One row a day. */
export async function recordActive(agencyId: string, userId: string) {
  try {
    await adminQuery("insert into active_days (agency_id, user_id, day) values ($1,$2,current_date) on conflict do nothing", [agencyId, userId]);
  } catch {}
}

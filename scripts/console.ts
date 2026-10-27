// The operator console: how each agency is using 8gency, as counts only. It never reads names of clients or jobs,
// messages, files or amounts (the privacy policy promises that). For support that needs more, ask the agency for
// time-limited permission first.
//   npm run console
import "./env";
import { adminQuery, closePools } from "../src/lib/db";

interface Row { id: string; name: string; created_at: Date; users: number; active_7d: number; active_30d: number; last_active: string | null; jobs: number; time_hours_30d: number; invoices: number; chat_msgs_30d: number; connections: number }

async function main() {
  const agencies = await adminQuery<Row>(
    `select a.id, a.name, a.created_at,
            (select count(*)::int from users u where u.agency_id = a.id and u.active and not u.is_sample) as users,
            (select count(distinct user_id)::int from active_days d where d.agency_id = a.id and d.day > current_date - 7) as active_7d,
            (select count(distinct user_id)::int from active_days d where d.agency_id = a.id and d.day > current_date - 30) as active_30d,
            (select max(day)::text from active_days d where d.agency_id = a.id) as last_active,
            (select count(*)::int from jobs j where j.agency_id = a.id) as jobs,
            (select coalesce(round(sum(hours)), 0)::int from time_entries t where t.agency_id = a.id and t.work_date > current_date - 30) as time_hours_30d,
            (select count(*)::int from invoices i where i.agency_id = a.id and i.status <> 'draft') as invoices,
            (select count(*)::int from chat_messages m where m.agency_id = a.id and m.kind = 'message' and m.created_at > now() - interval '30 days') as chat_msgs_30d,
            (select count(*)::int from connections c where c.agency_id = a.id) as connections
       from agencies a order by a.created_at`,
  );
  console.log(`Agencies: ${agencies.length}\n`);
  for (const a of agencies) {
    console.log(`${a.name}  (since ${a.created_at.toISOString().slice(0, 10)}, last active ${a.last_active ?? "never"})`);
    console.log(`  people ${a.users} · active 7d ${a.active_7d} · active 30d ${a.active_30d} · jobs ${a.jobs} · hours logged 30d ${a.time_hours_30d} · invoices ${a.invoices} · chat messages 30d ${a.chat_msgs_30d} · connections ${a.connections}`);
    const features = await adminQuery<{ feature: string; n: number }>(
      "select feature, sum(n)::int as n from usage_days where agency_id = $1 and day > current_date - 30 group by feature order by sum(n) desc limit 8",
      [a.id],
    );
    if (features.length) console.log(`  used in the last 30 days: ${features.map((f) => `${f.feature} ×${f.n}`).join(", ")}`);
  }
  const [{ waiting, invited }] = await adminQuery<{ waiting: number; invited: number }>("select count(*) filter (where invited_at is null)::int as waiting, count(*) filter (where invited_at is not null)::int as invited from waitlist");
  const [{ referred, qualified }] = await adminQuery<{ referred: number; qualified: number }>("select count(*)::int as referred, count(*) filter (where status = 'qualified')::int as qualified from referrals");
  console.log(`\nReferrals: ${referred} (${qualified} earned a free month)`);
  console.log(`Waitlist: ${waiting} waiting, ${invited} invited (npm run waitlist for the detail)`);
}
main().finally(() => closePools());

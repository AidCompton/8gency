// The waitlist, and which tools people use: the order to build integrations in.
//   npm run waitlist
import "./env";
import { adminQuery, closePools } from "../src/lib/db";
import { waitlistDemand } from "../src/lib/services/accountAuth";

async function main() {
  const people = await adminQuery<{ created_at: Date; name: string; email: string; agency_name: string; team_size: number | null; invited: boolean }>(
    "select created_at, name, email, agency_name, team_size, invited_at is not null as invited from waitlist order by created_at",
  );
  console.log(`Waitlist: ${people.length} (${people.filter((p) => p.invited).length} invited)\n`);
  for (const p of people) console.log(`${p.created_at.toISOString().slice(0, 10)}  ${p.invited ? "invited " : "waiting "} ${p.agency_name} (${p.team_size ?? "?"} people)  ${p.name} <${p.email}>`);
  const demand = await waitlistDemand();
  for (const kind of ["time", "projects", "accounting", "email"]) {
    console.log(`\nWhat they use for ${kind}:`);
    for (const d of demand.filter((x) => x.kind === kind)) console.log(`  ${String(d.n).padStart(3)}  ${d.tool}`);
  }
}
main().finally(() => closePools());

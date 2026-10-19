import Link from "next/link";
import { Card, HealthBadge, LinkButton, Meter, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { requireUser, tenant } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { clientHealthScores } from "@/lib/services/pulse";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const user = await requireUser();
  const { companies, health } = await tenant(user, async (tx) => ({
    companies: await tx.q<{ id: string; name: string; code: string; status: string; am: string | null; live_jobs: number; onboarding_done: number; onboarding_total: number; po_required: boolean }>(
      `select c.id, c.name, c.code, c.status, u.name as am, c.po_required,
              (select count(*)::int from jobs j where j.company_id = c.id and j.status not in ('closed')) as live_jobs,
              (select count(*)::int from onboarding_items o where o.company_id = c.id and o.done_at is not null) as onboarding_done,
              (select count(*)::int from onboarding_items o where o.company_id = c.id) as onboarding_total
         from companies c left join users u on u.id = c.account_manager_id where c.kind = 'client' order by c.status = 'former', c.name`,
    ),
    health: await clientHealthScores(tx),
  }));
  return (
    <>
      <PageHeader title="Clients" subtitle="Every client with onboarding progress, live work and health." actions={can(user, "manageJobs") && <LinkButton variant="primary" href="/app/clients/new">New client</LinkButton>} />
      <Card pad={false}>
        <Table head={["Client", "Status", "Account manager", "Live jobs", "Onboarding", "Health"]} empty="No clients yet. Add one, or import a CSV in Settings.">
          {companies.map((c) => {
            const h = health.find((x) => x.id === c.id);
            return (
              <tr key={c.id}>
                <Td><Link className="font-medium hover:underline" href={`/app/clients/${c.id}`}>{c.name}</Link> <span className="text-xs text-ink-3">{c.code}{c.po_required ? " · PO required" : ""}</span></Td>
                <Td><StatusBadge status={c.status} /></Td>
                <Td className="text-ink-2">{c.am ?? "—"}</Td>
                <Td right>{c.live_jobs}</Td>
                <Td className="w-40"><Meter value={c.onboarding_done} max={c.onboarding_total} compact label=" " sublabel={`${c.onboarding_done}/${c.onboarding_total}`} warnAt={2} /></Td>
                <Td>{h?.score !== null && h?.score !== undefined ? <span className="flex items-center gap-2"><span className="tnum">{h.score}</span><HealthBadge band={h.band} /></span> : <HealthBadge band="unknown" />}</Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}

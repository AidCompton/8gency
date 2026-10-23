import Link from "next/link";
import { Badge, Card, LinkButton, Meter, Money, PageHeader, StatusBadge, Table, Td, StatusIcon } from "@/components/ui";
import { requireUser, tenant } from "@/lib/auth";
import { formatShort, todayIn } from "@/lib/domain/dates";
import { can } from "@/lib/permissions";
import { listJobs } from "@/lib/services/jobs";

export const metadata = { title: "Jobs" };

const STATUSES = ["briefing", "in_progress", "waiting_client", "complete", "closed"];

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string; mine?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const seeAll = can(user, "seeAllJobs");
  const jobs = await tenant(user, (tx) =>
    listJobs(tx, { status: STATUSES.includes(sp.status ?? "") ? sp.status : undefined, userId: !seeAll || sp.mine ? user.id : undefined, includeClosed: sp.status === "closed" }),
  );
  const today = todayIn(user.timezone);
  const money = can(user, "seeMargins");
  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle="Every live job with status, owner, next deadline and budget burn. Rule 1: no work without a job."
        actions={can(user, "manageJobs") && <LinkButton href="/app/jobs/new" variant="primary">New job</LinkButton>}
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {[["", "All live"], ...STATUSES.map((s) => [s, s.replace("_", " ")])].map(([k, l]) => (
          <Link key={k} href={`/app/jobs${k ? `?status=${k}` : ""}`} className={`rounded-full border px-3 py-1 capitalize ${(sp.status ?? "") === k ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-2 hover:bg-surface-2"}`}>{l}</Link>
        ))}
        {seeAll && <Link href={`/app/jobs?mine=1`} className={`rounded-full border px-3 py-1 ${sp.mine ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-2"}`}>Mine</Link>}
      </div>
      <Card pad={false}>
        <Table head={["Job", "Client", "Status", "Owner", "Next due", "Budget burn", ...(money ? ["Fee"] : []), ""]} empty="No jobs match.">
          {jobs.map((j) => {
            const late = j.next_due && j.next_due < today;
            return (
              <tr key={j.id} className="hover:bg-surface-2/50">
                <Td>
                  <Link href={`/app/jobs/${j.id}`} className="font-medium hover:underline">{j.number}</Link>
                  <div className="max-w-[18rem] truncate text-xs text-ink-2">{j.name}</div>
                </Td>
                <Td className="text-ink-2">{j.company_name}</Td>
                <Td><StatusBadge status={j.status} /></Td>
                <Td className="text-ink-2">{j.owner_name ?? "—"}</Td>
                <Td className={late ? "font-medium text-critical-ink" : "text-ink-2"}><span className="inline-flex items-center gap-1">{late && <StatusIcon tone="critical" />}{formatShort(j.next_due ?? j.due_date)}{late && <span className="sr-only"> (late)</span>}</span></Td>
                <Td className="w-48">{j.budget_hours > 0 ? <Meter value={j.hours_used} max={j.budget_hours} compact sublabel={`${Math.round(j.hours_used)}h / ${j.budget_hours}h`} label=" " /> : <span className="text-xs text-ink-3">{Math.round(j.hours_used)}h · no budget</span>}</Td>
                {money && <Td right>{j.billing_model === "fixed" ? <Money cents={j.fee_cents} compact /> : <span className="text-xs uppercase text-ink-3">{j.billing_model}</span>}</Td>}
                <Td>
                  <div className="flex gap-1">
                    {j.rush && <Badge tone="critical">Rush</Badge>}
                    {j.blocked > 0 && <Badge tone="critical">{j.blocked} blocked</Badge>}
                    {j.waiting_client > 0 && <Badge tone="warning">{j.waiting_client} with client</Badge>}
                  </div>
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}

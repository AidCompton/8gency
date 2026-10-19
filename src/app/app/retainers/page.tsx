import Link from "next/link";
import { Card, Empty, LinkButton, Meter, Money, PageHeader, Pct } from "@/components/ui";
import { requireCap, requireUser, tenant } from "@/lib/auth";
import { formatShort } from "@/lib/domain/dates";
import { can } from "@/lib/permissions";
import { listRetainers } from "@/lib/services/retainers";

export const metadata = { title: "Retainers" };

export default async function RetainersPage() {
  const user = await requireUser();
  requireCap(user, "seeBudgetBurn");
  const rs = await tenant(user, (tx) => listRetainers(tx));
  const money = can(user, "seeMargins");
  return (
    <>
      <PageHeader title="Retainers" subtitle="Live burn against the month, so overservicing shows up mid-month, not at month end." actions={can(user, "manageJobs") && <LinkButton variant="primary" href="/app/retainers/new">New retainer</LinkButton>} />
      {rs.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {rs.map((r) => (
            <Card key={r.retainer.id} title={<Link className="hover:underline" href={`/app/retainers/${r.retainer.id}`}>{r.retainer.company_name} · {r.retainer.name}</Link>}>
              <Meter value={r.usedHours} max={r.allocated} label={r.period ? `${formatShort(r.period.starts_on)} – ${formatShort(r.period.ends_on)}` : "No open period"} sublabel={`${r.usedHours}h / ${r.allocated}h`} marker={r.burn?.elapsed} markerLabel="period elapsed" />
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><div className="text-xs text-ink-3">Projected</div><Pct n={r.burn?.projected} /></div>
                <div><div className="text-xs text-ink-3">Fee</div><Money cents={r.period?.fee_cents ?? r.retainer.fee_cents} visible={money} compact /></div>
                <div><div className="text-xs text-ink-3">Margin</div>{money ? <Pct n={r.margin} /> : "•••"}</div>
              </div>
              {r.burn?.alert && <p className="mt-2 text-sm text-critical-ink">● Burn is {Math.round(r.burn.aheadBy * 100)} points ahead of the period. Talk to the client or raise a change request.</p>}
            </Card>
          ))}
        </div>
      ) : <Empty>No retainers yet.</Empty>}
      <p className="mt-3 text-xs text-ink-3">The black tick on each meter marks how much of the period has passed.</p>
    </>
  );
}

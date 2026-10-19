import Link from "next/link";
import { notFound } from "next/navigation";
import { reconcileAction } from "../../_actions/retainers";
import { Card, Meter, Money, PageHeader, Pct, StatusBadge, Table, Td, buttonClass } from "@/components/ui";
import { requireUser, tenant } from "@/lib/auth";
import { formatDate, formatShort, todayIn } from "@/lib/domain/dates";
import { can } from "@/lib/permissions";
import { retainerHistory, retainerStatus } from "@/lib/services/retainers";
import { scopeUsage } from "@/lib/services/scope";

export const metadata = { title: "Retainer" };

export default async function RetainerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const money = can(user, "seeMargins");
  const data = await tenant(user, async (tx) => {
    const s = await retainerStatus(tx, id);
    if (!s) return null;
    return {
      s,
      history: await retainerHistory(tx, id),
      scope: s.period ? await scopeUsage(tx, { retainerId: id, from: s.period.starts_on, to: s.period.ends_on }) : [],
      jobs: await tx.q<{ id: string; number: string; name: string; status: string }>("select id, number, name, status from jobs where retainer_id = $1 order by start_date desc limit 12", [id]),
    };
  });
  if (!data) notFound();
  const { s } = data;
  const r = s.retainer;
  const today = todayIn(user.timezone);
  return (
    <>
      <PageHeader back={{ href: "/app/retainers", label: "Retainers" }} title={`${r.company_name} · ${r.name}`}
        subtitle={<>{r.hours_per_period}h / month · {r.billing_timing === "advance" ? "billed in advance" : "billed in arrears"} · rollover {r.rollover === "capped" ? `capped at ${r.rollover_cap_hours}h` : "none"}{r.next_increase_date ? ` · next increase ${r.price_increase_pct}% on ${formatDate(r.next_increase_date)}` : ""}</>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title={s.period ? `This period: ${formatShort(s.period.starts_on)} – ${formatShort(s.period.ends_on)}` : "No period open"}>
          <Meter value={s.usedHours} max={s.allocated} label="Hours used" sublabel={`${s.usedHours}h of ${s.allocated}h${s.period?.rollover_in_hours ? ` (incl. ${s.period.rollover_in_hours}h rolled over)` : ""}`} marker={s.burn?.elapsed} markerLabel="period elapsed" />
          {s.burn && (
            <p className={`mt-2 text-sm ${s.burn.alert ? "text-critical-ink" : "text-ink-2"}`}>
              {s.burn.alert ? "● " : ""}{Math.round(s.burn.burn * 100)}% used with {Math.round(s.burn.elapsed * 100)}% of the period gone. At this pace the month ends at {Math.round(s.burn.projected * 100)}%.
            </p>
          )}
          {data.scope.length > 0 && (
            <div className="mt-5 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Deliverables bank this period</h3>
              {data.scope.map((i) => <Meter key={i.id} value={i.used} max={i.quantity} compact label={i.name} sublabel={`${i.used} / ${i.quantity}${i.unit === "hours" ? "h" : ""}`} />)}
            </div>
          )}
        </Card>
        <Card title="Recurring jobs">
          <ul className="space-y-1.5 text-sm">{data.jobs.map((j) => <li key={j.id} className="flex justify-between gap-2"><Link href={`/app/jobs/${j.id}`} className="truncate hover:underline">{j.number} {j.name}</Link><StatusBadge status={j.status} /></li>)}</ul>
        </Card>
      </div>
      <Card title="Periods and month-end reconciliation" className="mt-4" pad={false}>
        <Table head={["Period", "Agreed", "Delivered", "Over / rollover", ...(money ? ["Fee", "Labour cost", "Margin"] : []), "Status", ""]}>
          {data.history.map((p) => {
            const allocated = p.allocated_hours + p.rollover_in_hours;
            const used = p.status === "reconciled" ? p.used_hours ?? 0 : p.live_used_hours;
            const over = Math.max(0, used - allocated);
            return (
              <tr key={p.id}>
                <Td>{formatShort(p.starts_on)} – {formatShort(p.ends_on)}</Td>
                <Td right>{allocated}h</Td>
                <Td right className={over > 0 ? "text-critical-ink" : ""}>{Math.round(used * 100) / 100}h</Td>
                <Td className="text-xs text-ink-2">{p.status === "reconciled" ? `${p.overage_hours}h over (${p.overage_action}) · ${p.rollover_out_hours}h rolled` : over > 0 ? `${Math.round(over * 100) / 100}h over so far` : "—"}</Td>
                {money && <><Td right><Money cents={p.fee_cents} /></Td><Td right><Money cents={p.labour_cost} visible={can(user, "seeCostRates")} /></Td><Td right><Pct n={p.fee_cents ? (p.fee_cents - p.labour_cost) / p.fee_cents : null} /></Td></>}
                <Td><StatusBadge status={p.status} /></Td>
                <Td>
                  {p.status === "open" && p.ends_on < today && can(user, "billing") && (
                    <form action={reconcileAction} className="flex flex-wrap items-center gap-1">
                      <input type="hidden" name="retainer_id" value={id} />
                      <input type="hidden" name="period_id" value={p.id} />
                      {over > 0 ? (
                        <>
                          <button name="action" value="change_request" className={buttonClass("primary", "sm")}>Bill overage</button>
                          <input name="reason" placeholder="or absorb because…" className="!w-36 !py-1 text-xs" />
                          <button name="action" value="absorbed" className={buttonClass("ghost", "sm")}>Absorb</button>
                        </>
                      ) : <button name="action" value="change_request" className={buttonClass("secondary", "sm")}>Reconcile</button>}
                    </form>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}

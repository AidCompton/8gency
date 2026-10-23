import Link from "next/link";
import {
  AddressBook, ArrowsLeftRight, Briefcase, Buildings, Clock, Coins, Export, FileText, Gear, Image, ListChecks, MagnifyingGlass, Pulse, Receipt, Repeat, ShieldCheck, UserGear,
} from "@phosphor-icons/react/ssr";
import type { Icon } from "@phosphor-icons/react";
import { Stagger } from "@/components/Motion";
import { Card, Empty, PageHeader, TONE, cx, type Tone } from "@/components/ui";
import { requireCap, requireUser, tenant } from "@/lib/auth";
import { formatMoney } from "@/lib/domain/money";
import { can } from "@/lib/permissions";

export const metadata = { title: "Audit log" };

const MONEY_KEYS = /cost|rate_cents|margin|salary/i;

/** Record type → how it reads in the log. Unknown types fall back to a humanised name. */
const CATEGORY: Record<string, { one: string; many: string; icon: Icon; tone: Tone }> = {
  invoice: { one: "Invoice", many: "Invoices", icon: Receipt, tone: "good" },
  job: { one: "Job", many: "Jobs", icon: Briefcase, tone: "info" },
  deliverable: { one: "Deliverable", many: "Deliverables", icon: Image, tone: "brand" },
  change_request: { one: "Change request", many: "Change requests", icon: ArrowsLeftRight, tone: "warning" },
  retainer: { one: "Retainer", many: "Retainers", icon: Repeat, tone: "brand" },
  retainer_period: { one: "Retainer period", many: "Retainer periods", icon: Repeat, tone: "brand" },
  company: { one: "Client", many: "Clients", icon: Buildings, tone: "neutral" },
  contact: { one: "Contact", many: "Contacts", icon: AddressBook, tone: "neutral" },
  contract: { one: "Contract", many: "Contracts", icon: FileText, tone: "neutral" },
  user: { one: "Person", many: "People", icon: UserGear, tone: "neutral" },
  agency: { one: "Agency", many: "Agency", icon: Gear, tone: "neutral" },
  time_entry: { one: "Time", many: "Time", icon: Clock, tone: "info" },
  cost: { one: "Cost", many: "Costs", icon: Coins, tone: "warning" },
  brief: { one: "Brief", many: "Briefs", icon: ListChecks, tone: "info" },
  scope: { one: "Scope", many: "Scope", icon: ShieldCheck, tone: "info" },
  export: { one: "Export", many: "Exports", icon: Export, tone: "neutral" },
};

const ACTION: Record<string, string> = {
  "agency.created": "Agency created",
  "brief.override": "Brief threshold overridden",
  "brief.signed_off": "Brief signed off",
  "change_request.absorbed": "Change request absorbed",
  "change_request.created": "Change request drafted",
  "change_request.sent": "Change request sent to client",
  "change_request.updated": "Change request updated",
  "company.created": "Client added",
  "company.updated": "Client updated",
  "contact.access_revoked": "Hub access revoked",
  "contact.created": "Contact added",
  "contract.created": "Contract recorded",
  "cost.created": "Cost added",
  "deliverable.created": "Deliverable created",
  "deliverable.sent_to_client": "Sent to client for approval",
  "deliverable.client_approved": "Approved by client",
  "deliverable.client_changes_requested": "Client requested changes",
  "deliverable.internal_approved": "Passed internal review",
  "deliverable.internal_changes_requested": "Internal review asked for changes",
  "export.all": "Full data export",
  "export.time": "Timesheets exported",
  "export.xero": "Exported to Xero",
  "import.time": "Timesheets imported",
  "invoice.draft_deleted": "Draft invoice deleted",
  "invoice.drafted": "Invoice drafted",
  "invoice.payment": "Payment recorded",
  "invoice.sent": "Invoice issued",
  "invoice.voided": "Invoice voided",
  "invoice.write_off": "Amount written off",
  "job.closed": "Job closed",
  "job.created": "Job created",
  "job.status": "Job status changed",
  "job.updated": "Job updated",
  "milestone.completed": "Milestone completed",
  "rate_card.added": "Rate added to rate card",
  "request.accepted": "Client request accepted",
  "request.dismissed": "Client request dismissed",
  "retainer.created": "Retainer created",
  "retainer.price_increase": "Retainer price increased",
  "retainer.reconciled": "Retainer period reconciled",
  "scope.locked": "Scope locked",
  "settings.agency": "Agency settings changed",
  "settings.entity": "Billing entity changed",
  "status_report.sent": "Status report sent",
  "time.closed_job_override": "Time logged on a closed job",
  "time.locked": "Timesheets locked",
  "user.created": "Person added",
  "user.deactivated": "Person deactivated",
  "user.updated": "Person updated",
};

const human = (s: string) => {
  const t = s.replace(/[._]/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const category = (type: string) => CATEGORY[type] ?? { one: human(type), many: human(type), icon: Pulse, tone: "neutral" as Tone };
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

type Row = { id: number; actor_label: string; action: string; record_type: string; before: unknown; after: unknown; created_at: Date };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const { q = "", type = "" } = await searchParams;
  const user = await requireUser();
  requireCap(user, "audit");
  const { rows, counts } = await tenant(user, async (tx) => ({
    rows: await tx.q<Row>(
      `select id, actor_label, action, record_type, before, after, created_at from audit_events
        where ($1 = '' or action ilike '%' || $1 || '%' or actor_label ilike '%' || $1 || '%' or record_type ilike '%' || $1 || '%')
          and ($2 = '' or record_type = $2)
        order by id desc limit 300`,
      [q, type],
    ),
    counts: await tx.q<{ record_type: string; n: number }>("select record_type, count(*)::int as n from audit_events group by 1 order by 2 desc"),
  }));
  const total = counts.reduce((s, c) => s + c.n, 0);

  const masked = (k: string) => !can(user, "seeCostRates") && MONEY_KEYS.test(k);
  const show = (k: string, v: unknown) => {
    if (v === null || v === undefined) return "—";
    if (masked(k)) return "•••";
    if (k.endsWith("_cents") && typeof v === "number") return formatMoney(v);
    const s = typeof v === "string" ? v : Array.isArray(v) && v.every((x) => typeof x === "string") ? v.join(", ") : JSON.stringify(v, (kk, val) => (masked(kk) ? "•••" : val));
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  };
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  /** The record's own name (invoice number, job name…), shown in the title instead of as a change. */
  const refKey = (a: Record<string, unknown>) => ["number", "name", "title"].find((k) => typeof a[k] === "string");
  /** One entry per field that changed or was set. A key only in `before` wasn't recorded afterwards, so it reads "was …". */
  const changes = (before: unknown, after: unknown, skip?: string) => {
    const b = obj(before);
    const a = obj(after);
    return [...new Set([...Object.keys(b), ...Object.keys(a)])]
      .filter((k) => k !== skip && JSON.stringify(b[k]) !== JSON.stringify(a[k]))
      .map((k) => ({ k, label: k.replace(/_cents$/, "").replace(/_/g, " "), from: k in b ? show(k, b[k]) : null, to: k in a ? show(k, a[k]) : null }));
  };

  const dayKey = (d: Date) => d.toLocaleDateString("en-CA");
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const dayLabel = (d: Date) => {
    const k = dayKey(d);
    return k === today ? "Today" : k === yesterday ? "Yesterday" : d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  };
  const days: { label: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const label = dayLabel(new Date(r.created_at));
    if (days.at(-1)?.label === label) days.at(-1)!.rows.push(r);
    else days.push({ label, rows: [r] });
  }

  const href = (t: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (t) p.set("type", t);
    return p.size ? `/app/audit?${p}` : "/app/audit";
  };
  const chip = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors pointer-coarse:min-h-11";

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle={<>Every approval, financial change, permission change and export, with before and after values. Immutable · <span className="tnum">{total}</span> events.</>}
      />

      <div className="mb-4 space-y-3">
        <form className="relative max-w-md" role="search">
          <MagnifyingGlass aria-hidden size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          {type && <input type="hidden" name="type" value={type} />}
          <input name="q" type="search" aria-label="Search the audit log" defaultValue={q} placeholder="Search by action, person or record…" className="!pl-9" />
        </form>
        <nav aria-label="Filter by record type" className="flex flex-wrap gap-2">
          <Link href={href("")} aria-current={!type ? "page" : undefined} className={cx(chip, !type ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-2 hover:bg-surface-2 hover:text-ink")}>
            All <span className="tnum text-xs opacity-80">{total}</span>
          </Link>
          {counts.map((c) => {
            const cat = category(c.record_type);
            const active = type === c.record_type;
            return (
              <Link key={c.record_type} href={href(c.record_type)} aria-current={active ? "page" : undefined} className={cx(chip, active ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-2 hover:bg-surface-2 hover:text-ink")}>
                <cat.icon aria-hidden size={14} />
                {cat.many} <span className="tnum text-xs opacity-80">{c.n}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <Card pad={false}>
        {rows.length === 0 ? (
          <div className="p-4">
            <Empty>
              {q || type ? "Nothing in the log matches this filter." : "Nothing logged yet."}{" "}
              {(q || type) && <Link className="text-brand hover:underline" href="/app/audit">Clear filters</Link>}
            </Empty>
          </div>
        ) : (
          <Stagger replay={`${q}|${type}`}>
            {days.map((day) => (
              <section key={day.label} aria-label={day.label}>
                <h2 data-stagger className="flex items-center justify-between border-b border-line bg-surface-2/60 px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-3 [section+section_&]:border-t">
                  {day.label}
                  <span className="tnum normal-case tracking-normal">{day.rows.length} {day.rows.length === 1 ? "event" : "events"}</span>
                </h2>
                <ol className="divide-y divide-line">
                  {day.rows.map((r) => {
                    const cat = category(r.record_type);
                    const a = obj(r.after);
                    const ref = refKey(a);
                    const list = changes(r.before, r.after, ref);
                    const at = new Date(r.created_at);
                    return (
                      <li key={r.id} data-stagger className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-x-3 px-4 py-3 transition-colors hover:bg-surface-2/50">
                        <span className={cx("grid h-8 w-8 place-items-center rounded-lg", TONE[cat.tone])}>
                          <cat.icon aria-hidden size={16} weight="bold" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm leading-snug">
                            <span className="font-medium text-ink" title={r.action}>{ACTION[r.action] ?? human(r.action)}</span>
                            {ref && <span className="text-ink-2"> · {String(a[ref])}</span>}
                          </p>
                          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-3">
                            <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-surface-2 text-[10px] font-semibold text-ink-2">{initials(r.actor_label)}</span>
                            <span className="text-ink-2">{r.actor_label}</span>
                            <span aria-hidden>·</span>
                            {cat.one}
                          </p>
                          {list.length > 0 && (
                            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Changes">
                              {list.map((c) => (
                                <li key={c.k} className="inline-flex max-w-full items-baseline gap-1.5 rounded-md border border-line bg-surface px-2 py-0.5 text-xs wrap-anywhere">
                                  <span className="shrink-0 text-ink-3">{c.label}</span>
                                  {c.to === null ? (
                                    <span className="text-ink-3">was {c.from}</span>
                                  ) : (
                                    <span>
                                      {c.from !== null && (
                                        <>
                                          <span className="text-ink-3 line-through decoration-ink-3/60">{c.from}</span> <span aria-hidden className="text-ink-3">→</span>
                                          <span className="sr-only">changed to</span>{" "}
                                        </>
                                      )}
                                      <span className="text-ink">{c.to}</span>
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <time dateTime={at.toISOString()} title={at.toLocaleString("en-ZA")} className="tnum pt-0.5 text-xs text-ink-3">
                          {at.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
                        </time>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </Stagger>
        )}
      </Card>
      {rows.length === 300 && <p className="mt-3 text-center text-xs text-ink-3">Showing the latest 300 events. Search or filter to find older ones.</p>}
    </>
  );
}

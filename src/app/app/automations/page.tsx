import { Lightning, Play, Plus } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { AutomationIcon, MiniFlow, toneFor } from "@/components/AutomationIcon";
import { Stagger } from "@/components/Motion";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, Card, PageHeader, Stat, Table, Tabs, Td, buttonClass, cx } from "@/components/ui";
import { runAutomationsNowAction, toggleAutomationAction, useTemplateAction } from "../_actions/automations";
import { requireCap, requireUser, tenant, requireModule } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { BUILTINS, TEMPLATES, actionDef, triggerDef, type Step } from "@/lib/domain/automations";
import { enabledBuiltins } from "@/lib/services/automationEngine";

export const metadata = { title: "Automations" };

type Row = { id: string; name: string; description: string; enabled: boolean; builtin: string | null; template_key: string | null; trigger: Step; actions: Step[]; filters: unknown[]; run_count: number; last_run_at: Date | null };

const ago = (d: Date | null) => {
  if (!d) return "never";
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

/** Flow icons for a custom automation (from its steps) or a built-in (from its definition). */
function steps(r: Row) {
  const b = BUILTINS.find((x) => x.key === r.builtin);
  if (b) return [{ icon: b.trigger.icon, kind: "trigger" as const }, ...b.actions.map((a) => ({ icon: a.icon, kind: "action" as const }))];
  return [
    { icon: triggerDef(r.trigger?.type)?.icon ?? ("funnel" as const), kind: "trigger" as const },
    ...(r.filters.length ? [{ icon: "funnel" as const, kind: "filter" as const }] : []),
    ...r.actions.map((a) => ({ icon: actionDef(a.type)?.icon ?? ("bell" as const), kind: "action" as const })),
  ];
}

function Toggle({ id, enabled, name, back }: { id: string; enabled: boolean; name: string; back: string }) {
  return (
    <form action={toggleAutomationAction} className="relative z-10">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <input type="hidden" name="back" value={back} />
      <SubmitButton role="switch" aria-checked={enabled} aria-label={`${name}: ${enabled ? "on, switch off" : "off, switch on"}`} className="grid place-items-center rounded-full pointer-coarse:min-h-11">
        <span className={cx("relative inline-flex h-6 w-11 items-center rounded-full transition-colors", enabled ? "bg-brand" : "bg-track")}>
          <span className={cx("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", enabled ? "translate-x-[22px]" : "translate-x-0.5")} />
        </span>
      </SubmitButton>
    </form>
  );
}

function AutomationCard({ r }: { r: Row }) {
  return (
    <li data-stagger className="group relative flex flex-col rounded-xl border border-line bg-surface p-4 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-brand/40 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <MiniFlow steps={steps(r)} />
        <Toggle id={r.id} enabled={r.enabled} name={r.name} back="/app/automations" />
      </div>
      <Link href={`/app/automations/${r.id}`} className="mt-3 font-semibold text-ink after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-[var(--focus)]">
        {r.name}
      </Link>
      <p className="mt-1 line-clamp-2 flex-1 text-sm text-ink-2">{r.description || (r.trigger?.type ? `${triggerDef(r.trigger.type)?.label} → ${r.actions.map((a) => actionDef(a.type)?.label.toLowerCase()).join(", ")}` : "")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <Badge tone={r.builtin ? "neutral" : "brand"}>{r.builtin ? "Built-in" : "Custom"}</Badge>
        <span>{r.builtin ? `Checked ${ago(r.last_run_at)}` : `Ran ${r.run_count} ${r.run_count === 1 ? "time" : "times"} · ${ago(r.last_run_at)}`}</span>
      </div>
    </li>
  );
}

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab ?? "mine";
  const user = await requireUser();
  requireModule(user, "automations");
  requireCap(user, "automations");
  const data = await tenant(user, async (tx) => {
    await enabledBuiltins(tx);
    return {
      rows: await tx.q<Row>("select id, name, description, enabled, builtin, template_key, trigger, actions, filters, run_count, last_run_at from automations order by builtin nulls first, created_at"),
      stats: (await tx.one<{ runs: number; errors: number; messages: number }>(
        `select (select count(*)::int from automation_runs where created_at > now() - interval '7 days') as runs,
                (select count(*)::int from automation_runs where status = 'error' and created_at > now() - interval '7 days') as errors,
                (select count(*)::int from outbox_messages where related_type = 'automation' and created_at > now() - interval '7 days') as messages`,
      ))!,
      runs: tab === "activity"
        ? await tx.q<{ id: string; automation_id: string; name: string; status: string; summary: string; created_at: Date }>(
            "select r.id, r.automation_id, a.name, r.status, r.summary, r.created_at from automation_runs r join automations a on a.id = r.automation_id order by r.created_at desc limit 100",
          )
        : [],
    };
  });
  const custom = data.rows.filter((r) => !r.builtin);
  const builtins = data.rows.filter((r) => r.builtin);
  const active = data.rows.filter((r) => r.enabled).length;
  const used = new Set(custom.map((r) => r.template_key).filter(Boolean));

  return (
    <>
      <PageHeader
        title="Automations"
        subtitle="Let 8gency do the follow-ups: when something happens, notify the right people, message the client or create the task. Built-in rules run every 15 minutes."
        actions={
          <>
            <form action={runAutomationsNowAction}>
              <SubmitButton className={buttonClass("secondary")}><Play aria-hidden size={14} weight="fill" /> Run scheduled now</SubmitButton>
            </form>
            <Link href="/app/automations/new" className={buttonClass("primary")}><Plus aria-hidden size={16} weight="bold" /> New automation</Link>
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active" value={active} hint={`${data.rows.length - active} switched off`} />
        <Stat label="Runs, last 7 days" value={data.stats.runs} hint="Custom automations" href="/app/automations?tab=activity" />
        <Stat label="Client messages sent" value={data.stats.messages} hint="Last 7 days, via the Outbox" href={can(user, "settings") ? "/app/outbox" : undefined} />
        <Stat label="Errors" value={data.stats.errors} hint={data.stats.errors ? "Check the activity log" : "All clear"} tone={data.stats.errors ? "critical" : "good"} href="/app/automations?tab=activity" />
      </div>
      <Tabs
        base="/app/automations"
        active={tab}
        tabs={[
          { key: "mine", label: `My automations · ${data.rows.length}` },
          { key: "templates", label: `Templates · ${TEMPLATES.length}` },
          { key: "activity", label: "Activity" },
        ]}
      />

      {tab === "mine" && (
        <div className="space-y-8">
          <section aria-labelledby="custom-h">
            <h2 id="custom-h" className="mb-3 text-sm font-semibold">Custom</h2>
            {custom.length ? (
              <Stagger>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{custom.map((r) => <AutomationCard key={r.id} r={r} />)}</ul>
              </Stagger>
            ) : (
              <div className="canvas-dots flex flex-col items-center gap-3 rounded-xl border border-dashed border-line px-6 py-10 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand/10 text-brand"><Lightning aria-hidden size={24} weight="fill" /></span>
                <div>
                  <p className="font-semibold">No custom automations yet</p>
                  <p className="mt-1 text-sm text-ink-2">Start from a template, or build one from scratch.</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <Link href="/app/automations?tab=templates" className={buttonClass("secondary", "sm")}>Browse templates</Link>
                  <Link href="/app/automations/new" className={buttonClass("primary", "sm")}>New automation</Link>
                </div>
              </div>
            )}
          </section>
          <section aria-labelledby="builtin-h">
            <h2 id="builtin-h" className="mb-1 text-sm font-semibold">Built-in rules</h2>
            <p className="mb-3 text-sm text-ink-2">8gency&apos;s operating rules. Switch any off if it doesn&apos;t fit how you work.</p>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{builtins.map((r) => <AutomationCard key={r.id} r={r} />)}</ul>
          </section>
        </div>
      )}

      {tab === "templates" && (
        <Stagger>
          {(["Clients", "Delivery", "Money", "Team"] as const).map((cat) => (
            <section key={cat} className="mb-6" data-stagger>
              <h2 className="mb-3 text-sm font-semibold">{cat}</h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {TEMPLATES.filter((t) => t.category === cat).map((t) => {
                  const tr = triggerDef(t.flow.trigger?.type)!;
                  return (
                    <li key={t.key} className="flex flex-col rounded-xl border border-line bg-surface p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <MiniFlow steps={[{ icon: tr.icon, kind: "trigger" }, ...t.flow.actions.map((a) => ({ icon: actionDef(a.type)!.icon, kind: "action" as const }))]} />
                        {used.has(t.key) && <Badge tone="good" dot>In use</Badge>}
                      </div>
                      <h3 className="mt-3 font-semibold">{t.name}</h3>
                      <p className="mt-1 flex-1 text-sm text-ink-2">{t.description}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                        <span className="inline-flex items-center gap-1"><AutomationIcon icon={tr.icon} tone={toneFor("trigger")} size="sm" /> {tr.label}</span>
                      </div>
                      <form action={useTemplateAction} className="mt-4">
                        <input type="hidden" name="key" value={t.key} />
                        <SubmitButton className={buttonClass("secondary", "sm") + " w-full"}>Use template</SubmitButton>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </Stagger>
      )}

      {tab === "activity" && (
        <Card pad={false}>
          <Table head={["When", "Automation", "Result", "What happened"]} empty="No automation has run yet.">
            {data.runs.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap text-xs text-ink-3">{new Date(r.created_at).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Td>
                <Td><Link className="font-medium hover:underline" href={`/app/automations/${r.automation_id}`}>{r.name}</Link></Td>
                <Td>{r.status === "ok" ? <Badge tone="good" dot>Ran</Badge> : r.status === "error" ? <Badge tone="critical" dot>Error</Badge> : <Badge dot>Skipped</Badge>}</Td>
                <Td className="max-w-[32rem] text-sm text-ink-2 wrap-anywhere">{r.summary}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}

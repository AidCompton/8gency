import { ArrowLeft, Lock } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutomationIcon, toneFor } from "@/components/AutomationIcon";
import { FlowBuilder } from "@/components/FlowBuilder";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, Card, Table, Td, cx } from "@/components/ui";
import { deleteAutomationAction, saveAutomationAction, toggleAutomationAction } from "../../_actions/automations";
import { requireCap, requireUser, tenant, requireModule } from "@/lib/auth";
import { BUILTINS, type Condition, type Step } from "@/lib/domain/automations";

export const metadata = { title: "Automation" };

type Row = { id: string; name: string; description: string; enabled: boolean; builtin: string | null; template_key: string | null; trigger: Step; filters: Condition[]; actions: Step[] };

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  requireModule(user, "automations");
  requireCap(user, "automations");
  const isNew = id === "new";
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await tenant(user, async (tx) => ({
    row: isNew ? null : await tx.one<Row>("select id, name, description, enabled, builtin, template_key, trigger, filters, actions from automations where id = $1", [id]),
    clients: await tx.q<{ id: string; name: string }>("select id, name from companies where kind = 'client' order by name"),
    connected: (await tx.q<{ provider: string }>("select distinct provider from connections where status = 'active'")).map((r) => r.provider),
    runs: isNew
      ? []
      : await tx.q<{ id: string; status: string; summary: string; created_at: Date }>("select id, status, summary, created_at from automation_runs where automation_id = $1 order by created_at desc limit 20", [id]),
  }));
  if (!isNew && !data.row) notFound();
  const row = data.row;

  const history = (
    <Card title="Recent runs" className="mt-5" pad={false}>
      <Table head={["When", "Result", "What happened"]} empty={row?.builtin ? "Built-in rules post their results as notifications and Outbox messages." : "Nothing yet. Runs show here as soon as the trigger fires."}>
        {data.runs.map((r) => (
          <tr key={r.id}>
            <Td className="whitespace-nowrap text-xs text-ink-3">{new Date(r.created_at).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Td>
            <Td>{r.status === "ok" ? <Badge tone="good" dot>Ran</Badge> : r.status === "error" ? <Badge tone="critical" dot>Error</Badge> : <Badge dot>Skipped</Badge>}</Td>
            <Td className="text-sm text-ink-2 wrap-anywhere">{r.summary}</Td>
          </tr>
        ))}
      </Table>
    </Card>
  );

  if (row?.builtin) {
    const b = BUILTINS.find((x) => x.key === row.builtin)!;
    const nodes = [{ ...b.trigger, kind: "trigger" as const, eyebrow: "When" }, ...b.actions.map((a, i) => ({ ...a, kind: "action" as const, eyebrow: `Then · step ${i + 1}` }))];
    return (
      <>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link href="/app/automations" className="group inline-flex items-center gap-1 rounded text-sm text-ink-3 transition-colors hover:text-ink pointer-coarse:min-h-11">
              <ArrowLeft aria-hidden size={14} className="transition-transform group-hover:-translate-x-0.5" /> Automations
            </Link>
            <h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
              {row.name} <Badge>Built-in</Badge>
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-2">{b.description}</p>
          </div>
          <form action={toggleAutomationAction} className="pt-6">
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="enabled" value={String(!row.enabled)} />
            <input type="hidden" name="back" value={`/app/automations/${row.id}`} />
            <SubmitButton role="switch" aria-checked={row.enabled} className="inline-flex items-center gap-2 rounded-lg text-sm font-medium text-ink-2 pointer-coarse:min-h-11">
              <span className={cx("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors", row.enabled ? "bg-brand" : "bg-track")}>
                <span className={cx("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", row.enabled ? "translate-x-[22px]" : "translate-x-0.5")} />
              </span>
              {row.enabled ? "On" : "Off"}
            </SubmitButton>
          </form>
        </div>
        <div className="canvas-dots overflow-x-auto rounded-xl border border-line shadow-sm">
          <div className="flex min-h-[300px] w-max min-w-full items-center px-8 py-12 max-md:w-full max-md:flex-col">
            {nodes.map((n, i) => (
              <div key={i} className="flex items-center max-md:flex-col">
                {i > 0 && <span aria-hidden className="bg-ink-3/40 max-md:h-10 max-md:w-px md:h-px md:w-20" />}
                <div className="flex w-64 items-start gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-sm">
                  <AutomationIcon icon={n.icon} tone={toneFor(n.kind, n.icon)} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold uppercase tracking-wider text-ink-3">{n.eyebrow}</span>
                    <span className="mt-0.5 block text-sm font-semibold">{n.label}</span>
                    <span className="mt-0.5 block text-xs text-ink-2">{n.detail}</span>
                  </span>
                  <Lock aria-hidden size={14} className="mt-1 text-ink-3" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-3 text-sm text-ink-2">
          Built-in rules can be switched on or off, not edited. Want a variation?{" "}
          <Link href="/app/automations?tab=templates" className="font-medium text-brand hover:underline">Start from a template</Link> or{" "}
          <Link href="/app/automations/new" className="font-medium text-brand hover:underline">build your own</Link>.
        </p>
        {history}
      </>
    );
  }

  return (
    <FlowBuilder
      id={row?.id ?? null}
      initial={{
        name: row?.name ?? "",
        description: row?.description ?? "",
        enabled: row?.enabled ?? true,
        flow: { trigger: row?.trigger?.type ? row.trigger : null, filters: row?.filters ?? [], actions: row?.actions ?? [] },
      }}
      clients={data.clients}
      connected={data.connected}
      templateKey={row?.template_key}
      saveAction={saveAutomationAction}
      deleteAction={row ? deleteAutomationAction : undefined}
      footer={row ? history : null}
    />
  );
}

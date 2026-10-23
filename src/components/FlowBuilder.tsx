"use client";
import { useGSAP } from "@gsap/react";
import { ArrowLeft, Lightning, Lock, Plus, Trash, X } from "@phosphor-icons/react";
import gsap from "gsap";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ACTIONS, FILTERS, TRIGGERS, VARIABLES, actionDef, defaults, triggerDef,
  type Condition, type Field, type FlowDef, type Step,
} from "@/lib/domain/automations";
import { AutomationIcon, toneFor } from "./AutomationIcon";
import { SubmitButton } from "./SubmitButton";
import { Badge, buttonClass, cx } from "./ui";

gsap.registerPlugin(useGSAP);

type Selected = { kind: "trigger" } | { kind: "filter" } | { kind: "action"; index: number } | { kind: "add"; at: number } | null;

const optionLabel = (f: Field, v: unknown) => f.options?.find((o) => o.value === v)?.label ?? String(v ?? "");

function triggerSummary(s: Step) {
  const d = triggerDef(s.type);
  if (!d) return "";
  if (s.type === "job.status_changed") return s.config.to === "any" ? "Any status" : `To ${optionLabel(d.fields[0], s.config.to).toLowerCase()}`;
  if (s.config.days !== undefined) return `${s.config.days} ${Number(s.config.days) === 1 ? "day" : "days"}`;
  if (s.config.percent !== undefined) return `${s.config.percent}% of budget`;
  return d.kind === "event" ? "As it happens" : "";
}

function actionSummary(s: Step) {
  const d = actionDef(s.type);
  if (!d) return "";
  if (d.connector) return "Needs a connector";
  const to = d.fields.find((f) => f.key === "to");
  if (s.type === "create_task") return `“${s.config.title}”`;
  if (s.type === "notify") return `${optionLabel(to!, s.config.to)} · “${s.config.message}”`;
  if (s.type === "email_client") return `${optionLabel(to!, s.config.to)} · “${s.config.subject}”`;
  return optionLabel(to!, s.config.to);
}

/**
 * The automation builder: a dot-grid canvas of connected nodes (When → Only if →
 * Then…) with an inspector for the selected node. Posts the whole flow as JSON.
 */
export function FlowBuilder({
  id,
  initial,
  clients,
  templateKey,
  saveAction,
  deleteAction,
  footer,
}: {
  id: string | null;
  initial: { name: string; description: string; enabled: boolean; flow: FlowDef };
  clients: { id: string; name: string }[];
  templateKey?: string | null;
  saveAction: (fd: FormData) => Promise<void>;
  deleteAction?: (fd: FormData) => Promise<void>;
  footer?: ReactNode;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [trigger, setTrigger] = useState<Step | null>(initial.flow.trigger);
  const [filters, setFilters] = useState<Condition[]>(initial.flow.filters);
  const [showFilter, setShowFilter] = useState(initial.flow.filters.length > 0);
  const [actions, setActions] = useState<Step[]>(initial.flow.actions);
  const [selected, setSelected] = useState<Selected>(initial.flow.trigger ? null : { kind: "trigger" });
  const [pickTrigger, setPickTrigger] = useState(!initial.flow.trigger);
  const [dirty, setDirty] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const lastField = useRef<{ index: number; key: string; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);
  const added = useRef<string | null>(null);

  const touch = () => {
    setDirty(true);
    setProblem(null);
  };
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // New nodes pop in (n8n-style), unless the user prefers reduced motion.
  useGSAP(
    () => {
      if (!added.current) return;
      const el = canvas.current?.querySelector(`[data-node="${added.current}"]`);
      added.current = null;
      if (!el) return;
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(el, { autoAlpha: 0, scale: 0.94, y: 6 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.3, ease: "power2.out", clearProps: "all" });
      });
    },
    { scope: canvas, dependencies: [actions.length, showFilter, trigger?.type] },
  );

  const chooseTrigger = (type: string) => {
    const d = triggerDef(type)!;
    if (!trigger) added.current = "trigger";
    setTrigger({ type, config: defaults(d.fields) as Step["config"] });
    setPickTrigger(false);
    setSelected({ kind: "trigger" });
    touch();
  };
  const addAction = (type: string, at: number) => {
    const d = actionDef(type)!;
    const next = [...actions];
    next.splice(at, 0, { type, config: defaults(d.fields) as Step["config"] });
    added.current = `action-${at}`;
    setActions(next);
    setSelected({ kind: "action", index: at });
    touch();
  };
  const removeAction = (i: number) => {
    setActions(actions.filter((_, n) => n !== i));
    setSelected(null);
    touch();
  };
  const setActionConfig = (i: number, key: string, value: string | number) => {
    setActions(actions.map((a, n) => (n === i ? { ...a, config: { ...a.config, [key]: value } } : a)));
    touch();
  };
  const insertVariable = (v: string) => {
    const f = lastField.current;
    if (!f || selected?.kind !== "action" || f.index !== selected.index) return;
    const cur = String(actions[f.index].config[f.key] ?? "");
    const at = f.el.selectionStart ?? cur.length;
    const end = f.el.selectionEnd ?? at;
    setActionConfig(f.index, f.key, `${cur.slice(0, at)}{{${v}}}${cur.slice(end)}`);
    requestAnimationFrame(() => {
      f.el.focus();
      const pos = at + v.length + 4;
      f.el.setSelectionRange(pos, pos);
    });
  };

  const flow: FlowDef = { trigger, filters: showFilter ? filters : [], actions };
  const check = () => {
    if (!name.trim()) return "Give the automation a name.";
    if (!trigger) return "Choose what starts the automation.";
    if (showFilter && filters.some((f) => !String(f.value).trim())) return "Fill in or remove the empty filter.";
    if (!actions.length) return "Add at least one action.";
    if (actions.some((a) => actionDef(a.type)?.connector)) return "Remove the steps that need a connector, then save.";
    return null;
  };

  const node = (key: string, props: { kind: "trigger" | "filter" | "action"; eyebrow: string; title: string; summary: string; icon: Parameters<typeof AutomationIcon>[0]["icon"]; active: boolean; onClick: () => void; onRemove?: () => void; locked?: boolean }) => (
    <div data-node={key} className="relative">
      <button
        type="button"
        onClick={props.onClick}
        aria-pressed={props.active}
        className={cx(
          "group flex w-64 items-start gap-3 rounded-xl border bg-surface p-3.5 text-left shadow-sm transition-[border-color,box-shadow] duration-150",
          props.active ? "border-brand shadow-md ring-2 ring-brand/30" : "border-line hover:border-ink-3/40 hover:shadow-md",
        )}
      >
        <AutomationIcon icon={props.icon} tone={props.locked ? "neutral" : toneFor(props.kind, props.icon)} />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-3">{props.eyebrow}</span>
          <span className="mt-0.5 block truncate text-sm font-semibold text-ink">{props.title}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-2">{props.summary}</span>
        </span>
        {props.locked && <Lock aria-hidden size={14} className="mt-1 text-ink-3" />}
      </button>
      {props.onRemove && (
        <button
          type="button"
          onClick={props.onRemove}
          aria-label={`Remove ${props.title}`}
          className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full border border-line bg-surface text-ink-3 shadow-sm transition-colors hover:border-critical/40 hover:text-critical-ink pointer-coarse:h-9 pointer-coarse:w-9"
        >
          <X aria-hidden size={12} weight="bold" />
        </button>
      )}
    </div>
  );

  const connector = (label?: string, onAdd?: () => void) => (
    <div className="relative flex shrink-0 items-center justify-center self-stretch max-md:h-14 max-md:flex-col md:w-20">
      <span aria-hidden className="bg-ink-3/40 max-md:h-full max-md:w-px md:h-px md:w-full" />
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={label}
          title={label}
          className="absolute grid h-6 w-6 place-items-center rounded-full border border-line bg-surface text-ink-3 shadow-sm transition-colors hover:border-brand hover:text-brand pointer-coarse:h-9 pointer-coarse:w-9"
        >
          <Plus aria-hidden size={12} weight="bold" />
        </button>
      )}
    </div>
  );

  const tDef = triggerDef(trigger?.type);
  const field = (f: Field, value: unknown, onChange: (v: string | number) => void, index?: number) => {
    const common = {
      id: `f-${index ?? "t"}-${f.key}`,
      name: undefined,
      onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (index !== undefined && (f.type === "text" || f.type === "textarea")) lastField.current = { index, key: f.key, el: e.currentTarget };
      },
    };
    return (
      <label key={f.key} className="block space-y-1">
        <span className="text-[13px] font-medium text-ink-2">{f.label}</span>
        {f.type === "select" ? (
          <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : f.type === "textarea" ? (
          <textarea {...common} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} rows={6} />
        ) : (
          <input {...common} inputMode={f.type === "number" ? "numeric" : undefined} value={String(value ?? "")} onChange={(e) => onChange(f.type === "number" ? Number(e.target.value.replace(/\D/g, "")) : e.target.value)} />
        )}
        {f.hint && <span className="block text-xs text-ink-3">{f.hint}</span>}
      </label>
    );
  };

  const inspector = () => {
    if (!selected) {
      return (
        <div className="grid h-full place-items-center p-6 text-center text-sm text-ink-3">
          <div>
            <Lightning aria-hidden size={24} className="mx-auto mb-2" />
            Select a step on the canvas to set it up, or use <b>+</b> to add one.
          </div>
        </div>
      );
    }
    if (selected.kind === "trigger" && (pickTrigger || !trigger)) {
      return (
        <div className="space-y-4">
          <Heading title="Choose a trigger" sub="What starts this automation?" />
          {(["event", "schedule"] as const).map((kind) => (
            <div key={kind}>
              <div className="mb-1.5 text-xs font-medium text-ink-3">{kind === "event" ? "When something happens" : "On a schedule (checked every 15 minutes)"}</div>
              <ul className="space-y-1">
                {TRIGGERS.filter((t) => t.kind === kind).map((t) => (
                  <li key={t.type}>
                    <button type="button" onClick={() => chooseTrigger(t.type)} className={cx("flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors", trigger?.type === t.type ? "border-brand bg-brand/5" : "border-transparent hover:border-line hover:bg-surface-2")}>
                      <AutomationIcon icon={t.icon} tone="warning" size="sm" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{t.label}</span>
                        <span className="block truncate text-xs text-ink-3">{t.description}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    }
    if (selected.kind === "trigger" && trigger && tDef) {
      return (
        <div className="space-y-4">
          <Heading icon={<AutomationIcon icon={tDef.icon} tone="warning" />} title={tDef.label} sub={tDef.description} />
          {tDef.fields.map((f) => field(f, trigger.config[f.key], (v) => (setTrigger({ ...trigger, config: { ...trigger.config, [f.key]: v } }), touch())))}
          {tDef.kind === "schedule" && <p className="text-xs text-ink-3">Runs once for each matching record, so nobody gets the same message twice.</p>}
          <button type="button" onClick={() => setPickTrigger(true)} className={buttonClass("secondary", "sm")}>Change trigger</button>
        </div>
      );
    }
    if (selected.kind === "filter") {
      return (
        <div className="space-y-4">
          <Heading icon={<AutomationIcon icon="funnel" tone="info" />} title="Only continue if…" sub="Every condition must match. Leave it out to run every time." />
          {filters.map((c, i) => {
            const def = FILTERS.find((f) => f.field === c.field)!;
            const set = (patch: Partial<Condition>) => (setFilters(filters.map((x, n) => (n === i ? { ...x, ...patch } : x))), touch());
            return (
              <div key={i} className="space-y-2 rounded-lg border border-line bg-surface-2/40 p-3">
                <div className="flex items-center gap-2">
                  <select aria-label="Condition" value={c.field} onChange={(e) => set({ field: e.target.value as Condition["field"], value: "" })}>
                    {FILTERS.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
                  </select>
                  <button type="button" onClick={() => (setFilters(filters.filter((_, n) => n !== i)), touch())} aria-label="Remove condition" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-critical/10 hover:text-critical-ink">
                    <Trash aria-hidden size={15} />
                  </button>
                </div>
                {def.input === "client" ? (
                  <select aria-label="Client" value={c.value} onChange={(e) => set({ value: e.target.value })}>
                    <option value="">Choose a client…</option>
                    {clients.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                  </select>
                ) : def.input === "select" ? (
                  <select aria-label={def.label} value={c.value} onChange={(e) => set({ value: e.target.value })}>
                    <option value="">Choose…</option>
                    {def.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input aria-label={def.label} inputMode="decimal" placeholder="e.g. 10000" value={c.value} onChange={(e) => set({ value: e.target.value.replace(/[^\d.]/g, "") })} />
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => (setFilters([...filters, { field: "company_id", value: "" }]), touch())} className={buttonClass("secondary", "sm")}>
              <Plus aria-hidden size={14} /> Add condition
            </button>
            <button type="button" onClick={() => (setShowFilter(false), setFilters([]), setSelected(null), touch())} className={buttonClass("ghost", "sm")}>Remove filter</button>
          </div>
        </div>
      );
    }
    if (selected.kind === "add") {
      return (
        <div className="space-y-4">
          <Heading title="Add an action" sub="What should happen next?" />
          <ul className="space-y-1">
            {ACTIONS.map((a) => (
              <li key={a.type}>
                <button
                  type="button"
                  disabled={!!a.connector}
                  onClick={() => addAction(a.type, selected.at)}
                  className="flex w-full items-center gap-3 rounded-lg border border-transparent p-2 text-left transition-colors enabled:hover:border-line enabled:hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <AutomationIcon icon={a.icon} tone={a.connector ? "neutral" : toneFor("action", a.icon)} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{a.label}</span>
                    <span className="block truncate text-xs text-ink-3">{a.description}</span>
                  </span>
                  {a.connector && <Badge>Soon</Badge>}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-3">
            Slack, Gmail and Calendar steps arrive with <Link href="/app/connectors" className="text-brand hover:underline">Connectors</Link>.
          </p>
        </div>
      );
    }
    if (selected.kind !== "action") return null;
    const a = actions[selected.index];
    const d = a && actionDef(a.type);
    if (!a || !d) return null;
    const hasText = d.fields.some((f) => f.type === "text" || f.type === "textarea");
    return (
      <div className="space-y-4">
        <Heading icon={<AutomationIcon icon={d.icon} tone={toneFor("action", d.icon)} />} title={d.label} sub={d.description} />
        {d.connector ? (
          <p className="rounded-lg border border-line bg-surface-2/60 p-3 text-sm text-ink-2">This step needs a connector that isn&apos;t live yet. Remove it to save.</p>
        ) : (
          d.fields.map((f) => field(f, a.config[f.key], (v) => setActionConfig(selected.index, f.key, v), selected.index))
        )}
        {hasText && !d.connector && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">Insert into the field you&apos;re typing in</div>
            <div className="flex flex-wrap gap-1.5">
              {VARIABLES.map((v) => (
                <button key={v.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertVariable(v.key)} title={v.label} className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-xs text-ink-2 transition-colors hover:border-brand hover:text-brand">
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
          </div>
        )}
        <button type="button" onClick={() => removeAction(selected.index)} className={buttonClass("ghost", "sm") + " !text-critical-ink"}>
          <Trash aria-hidden size={14} /> Remove step
        </button>
      </div>
    );
  };

  return (
    <form
      action={saveAction}
      onSubmit={(e) => {
        const p = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("formaction") ? null : check();
        if (p) {
          e.preventDefault();
          setProblem(p);
        } else setDirty(false);
      }}
    >
      {id && <input type="hidden" name="id" value={id} />}
      {templateKey && <input type="hidden" name="template_key" value={templateKey} />}
      <input type="hidden" name="flow" value={JSON.stringify(flow)} />
      <input type="hidden" name="enabled" value={String(enabled)} />

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link href="/app/automations" className="group inline-flex items-center gap-1 rounded text-sm text-ink-3 transition-colors hover:text-ink pointer-coarse:min-h-11">
            <ArrowLeft aria-hidden size={14} className="transition-transform group-hover:-translate-x-0.5" /> Automations
          </Link>
          <input
            name="name"
            aria-label="Automation name"
            value={name}
            onChange={(e) => (setName(e.target.value), touch())}
            placeholder="Name this automation"
            className="input-inline mt-1 !h-11 !px-2 !text-2xl font-semibold tracking-tight"
          />
          <input name="description" aria-label="Description" value={description} onChange={(e) => (setDescription(e.target.value), touch())} placeholder="What it's for (optional)" className="input-inline !px-2 text-ink-2" />
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-6">
          <button type="button" role="switch" aria-checked={enabled} onClick={() => (setEnabled(!enabled), touch())} className="inline-flex items-center gap-2 rounded-lg text-sm font-medium text-ink-2 pointer-coarse:min-h-11">
            <span className={cx("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors", enabled ? "bg-brand" : "bg-track")}>
              <span className={cx("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", enabled ? "translate-x-[22px]" : "translate-x-0.5")} />
            </span>
            {enabled ? "On" : "Off"}
          </button>
          {dirty ? <Badge tone="warning" dot>Unsaved</Badge> : id ? <Badge tone="good" dot>Saved</Badge> : null}
          {id && deleteAction && (
            <SubmitButton formAction={deleteAction} formNoValidate confirm="Delete this automation? Its run history goes too." className={buttonClass("ghost", "sm") + " !text-critical-ink"}>
              <Trash aria-hidden size={14} /> Delete
            </SubmitButton>
          )}
          <SubmitButton className={buttonClass("primary")}>Save automation</SubmitButton>
        </div>
      </div>
      {problem && (
        <p role="alert" className="mb-4 rounded-xl border border-critical/30 bg-critical/10 px-4 py-3 text-sm font-medium text-critical-ink">
          {problem}
        </p>
      )}

      <div className="relative overflow-hidden rounded-xl border border-line shadow-sm">
        <div ref={canvas} className="canvas-dots relative min-h-[480px] overflow-x-auto">
          <p className="pointer-events-none absolute left-4 top-3 text-xs text-ink-3">Click a step to edit it · <b className="font-semibold">+</b> adds one</p>
          <div className={cx("flex min-h-[480px] w-max min-w-full items-center px-8 py-12 max-md:w-full max-md:flex-col", selected && "lg:pr-[400px]")}>
            {trigger && tDef ? (
              node("trigger", { kind: "trigger", eyebrow: "When", title: tDef.label, summary: triggerSummary(trigger), icon: tDef.icon, active: selected?.kind === "trigger", onClick: () => (setSelected({ kind: "trigger" }), setPickTrigger(false)) })
            ) : (
              <button
                type="button"
                onClick={() => (setSelected({ kind: "trigger" }), setPickTrigger(true))}
                className={cx("flex w-64 flex-col items-center gap-2 rounded-xl border-2 border-dashed bg-surface/70 p-6 text-sm font-medium text-ink-2 transition-colors hover:border-brand hover:text-brand", selected?.kind === "trigger" ? "border-brand text-brand" : "border-line")}
              >
                <Lightning aria-hidden size={24} />
                Choose a trigger
              </button>
            )}
            {showFilter ? (
              <>
                {connector()}
                {node("filter", {
                  kind: "filter",
                  eyebrow: "Only if",
                  title: filters.length ? `${filters.length} ${filters.length === 1 ? "condition" : "conditions"}` : "Add a condition",
                  summary: filters.map((f) => FILTERS.find((x) => x.field === f.field)?.label).join(" · ") || "Runs only when these match",
                  icon: "funnel",
                  active: selected?.kind === "filter",
                  onClick: () => setSelected({ kind: "filter" }),
                  onRemove: () => (setShowFilter(false), setFilters([]), setSelected(null), touch()),
                })}
              </>
            ) : (
              trigger && connector("Add a filter", () => (added.current = "filter", setShowFilter(true), setFilters([{ field: "company_id", value: "" }]), setSelected({ kind: "filter" }), touch()))
            )}
            {actions.map((a, i) => {
              const d = actionDef(a.type);
              return (
                <Fragment key={i}>
                  {i > 0 && connector(`Insert an action before step ${i + 1}`, () => setSelected({ kind: "add", at: i }))}
                  {!showFilter && i === 0 ? null : i === 0 ? connector() : null}
                  {node(`action-${i}`, {
                    kind: "action",
                    eyebrow: `Then · step ${i + 1}`,
                    title: d?.label ?? a.type,
                    summary: actionSummary(a),
                    icon: d?.icon ?? "bell",
                    locked: !!d?.connector,
                    active: selected?.kind === "action" && selected.index === i,
                    onClick: () => setSelected({ kind: "action", index: i }),
                    onRemove: () => removeAction(i),
                  })}
                </Fragment>
              );
            })}
            {trigger && (
              <>
                {(actions.length > 0 || showFilter) && connector()}
                <button
                  type="button"
                  onClick={() => setSelected({ kind: "add", at: actions.length })}
                  className={cx("flex items-center gap-2 rounded-xl border-2 border-dashed bg-surface/70 px-4 py-3 text-sm font-medium transition-colors hover:border-brand hover:text-brand", selected?.kind === "add" && selected.at === actions.length ? "border-brand text-brand" : "border-line text-ink-2")}
                >
                  <Plus aria-hidden size={16} weight="bold" /> {actions.length ? "Add action" : "Add the first action"}
                </button>
              </>
            )}
          </div>
        </div>
        {/* Settings panel: slides over the canvas on desktop (n8n-style), sits below it on small screens. */}
        {selected && (
          <aside aria-label="Step settings" className="border-t border-line bg-surface p-5 lg:absolute lg:inset-y-0 lg:right-0 lg:w-[380px] lg:overflow-y-auto lg:border-l lg:border-t-0 lg:shadow-md">
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Close step settings"
              className="float-right -mr-1 -mt-1 grid h-8 w-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
            >
              <X aria-hidden size={16} />
            </button>
            {inspector()}
          </aside>
        )}
      </div>
      {footer}
    </form>
  );
}

function Heading({ icon, title, sub }: { icon?: ReactNode; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      {icon}
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-ink-2">{sub}</p>
      </div>
    </div>
  );
}

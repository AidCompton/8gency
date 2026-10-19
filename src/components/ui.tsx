import Link from "next/link";
import type { ReactNode } from "react";
import { formatHours, formatMoney, pct } from "@/lib/domain/money";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="text-sm text-ink-3 hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-ink-2">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean; id?: string }) {
  return (
    <section id={id} className={cx("rounded-xl border border-line bg-surface", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </div>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

/** KPI tile: one number, one label, optional context line. */
export function Stat({ label, value, hint, tone, href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "warning" | "critical"; href?: string }) {
  const body = (
    <div className="h-full rounded-xl border border-line bg-surface p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className="tnum mt-1 text-2xl font-semibold">{value}</div>
      {hint && (
        <div className={cx("mt-1 text-xs", tone === "critical" ? "text-critical-ink" : tone === "warning" ? "text-warning-ink" : tone === "good" ? "text-good-ink" : "text-ink-2")}>
          {tone && <StatusIcon tone={tone} />} {hint}
        </div>
      )}
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

export function StatusIcon({ tone }: { tone: "good" | "warning" | "critical" }) {
  const glyph = tone === "good" ? "✓" : tone === "warning" ? "▲" : "●";
  return (
    <span aria-hidden className={tone === "good" ? "text-good" : tone === "warning" ? "text-warning" : "text-critical"}>
      {glyph}
    </span>
  );
}

/**
 * Horizontal meter. The fill is sequential blue until it crosses a threshold;
 * state is always spelled out in the label text, never colour alone. An
 * optional marker shows a reference point such as time elapsed.
 */
export function Meter({ value, max, label, sublabel, marker, markerLabel, warnAt = 0.9, compact }: { value: number; max: number; label?: ReactNode; sublabel?: ReactNode; marker?: number; markerLabel?: string; warnAt?: number; compact?: boolean }) {
  const ratio = max > 0 ? value / max : value > 0 ? 2 : 0;
  const state = ratio > 1 ? "critical" : ratio >= warnAt ? "warning" : "ok";
  const fill = state === "critical" ? "bg-critical" : state === "warning" ? "bg-warning" : "bg-seq";
  const width = Math.min(100, ratio * 100);
  return (
    <div className="w-full" title={`${Math.round(ratio * 100)}% used${marker !== undefined && markerLabel ? ` · ${markerLabel} ${Math.round(marker * 100)}%` : ""}`}>
      {(label || sublabel) && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate text-ink-2">{label}</span>
          <span className={cx("tnum shrink-0", state === "critical" ? "font-medium text-critical-ink" : state === "warning" ? "text-warning-ink" : "text-ink-2")}>
            {state === "critical" && <StatusIcon tone="critical" />} {sublabel ?? `${Math.round(ratio * 100)}%`}
            {state === "critical" && <span className="sr-only"> over</span>}
          </span>
        </div>
      )}
      <div className={cx("relative w-full rounded-full bg-track", compact ? "h-1.5" : "h-2")}>
        <div className={cx("h-full rounded-full", fill)} style={{ width: `${width}%` }} />
        {marker !== undefined && (
          <div className="absolute -top-1 h-[calc(100%+8px)] w-0.5 rounded bg-ink" style={{ left: `calc(${Math.min(100, marker * 100)}% - 1px)` }} aria-label={markerLabel} />
        )}
      </div>
    </div>
  );
}

/** Single-series horizontal bar list with direct value labels (no legend needed). */
export function BarList({ rows, format, max }: { rows: { label: ReactNode; value: number; note?: ReactNode; href?: string; negative?: boolean }[]; format: (v: number) => string; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={i} className="grid grid-cols-[minmax(0,13rem)_1fr_auto] items-center gap-3 text-sm max-sm:grid-cols-[minmax(0,7rem)_1fr_auto]" title={`${typeof r.label === "string" ? r.label : ""} ${format(r.value)}`}>
          <span className="truncate text-ink-2">{r.href ? <Link className="hover:text-ink hover:underline" href={r.href}>{r.label}</Link> : r.label}</span>
          <span className="h-2 rounded-full bg-track">
            <span className={cx("block h-full rounded-full", r.value < 0 || r.negative ? "bg-critical" : "bg-seq")} style={{ width: `${Math.min(100, (Math.abs(r.value) / top) * 100)}%` }} />
          </span>
          <span className="tnum text-right text-ink">
            {format(r.value)}
            {r.note && <span className="ml-1 text-xs text-ink-3">{r.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const BADGE: Record<string, string> = {
  neutral: "bg-surface-2 text-ink-2",
  brand: "bg-brand/10 text-brand",
  good: "bg-good/10 text-good-ink",
  warning: "bg-warning/15 text-warning-ink",
  critical: "bg-critical/10 text-critical-ink",
  info: "bg-seq/10 text-seq",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof BADGE }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", BADGE[tone])}>{children}</span>;
}

const STATUS_TONE: Record<string, keyof typeof BADGE> = {
  briefing: "neutral",
  in_progress: "info",
  waiting_client: "warning",
  complete: "good",
  closed: "neutral",
  todo: "neutral",
  blocked: "critical",
  done: "good",
  draft: "neutral",
  internal_review: "brand",
  client_review: "warning",
  changes_requested: "critical",
  approved: "good",
  sent: "info",
  declined: "neutral",
  absorbed: "warning",
  paid: "good",
  void: "neutral",
  new: "brand",
  accepted: "good",
  change_request: "info",
  dismissed: "neutral",
  open: "info",
  reconciled: "good",
  onboarding: "brand",
  active: "good",
  paused: "neutral",
  former: "neutral",
};

export function HealthBadge({ band }: { band: string }) {
  const map: Record<string, [keyof typeof BADGE, string]> = { healthy: ["good", "✓ Healthy"], watch: ["warning", "▲ Watch"], at_risk: ["critical", "● At risk"], unknown: ["neutral", "No data yet"] };
  const [tone, label] = map[band] ?? map.unknown;
  return <Badge tone={tone}>{label}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

const BTN = {
  primary: "bg-brand text-brand-ink hover:opacity-90",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "border border-critical/40 text-critical-ink hover:bg-critical/10",
};

export function buttonClass(variant: keyof typeof BTN = "primary", size: "sm" | "md" = "md") {
  return cx("inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-50", size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm", BTN[variant]);
}

export function Button({ children, variant = "primary", size = "md", name, value, formAction, title }: { children: ReactNode; variant?: keyof typeof BTN; size?: "sm" | "md"; name?: string; value?: string; formAction?: (fd: FormData) => void | Promise<void>; title?: string }) {
  return (
    <button type="submit" className={buttonClass(variant, size)} name={name} value={value} formAction={formAction} title={title}>
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "secondary", size = "md" }: { href: string; children: ReactNode; variant?: keyof typeof BTN; size?: "sm" | "md" }) {
  return (
    <Link href={href} className={buttonClass(variant, size)}>
      {children}
    </Link>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={cx("block space-y-1", className)}>
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  const hasRows = Array.isArray(children) ? children.flat().filter(Boolean).length > 0 : Boolean(children);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {!hasRows && empty && <div className="px-3 py-8 text-center text-sm text-ink-3">{empty}</div>}
    </div>
  );
}

export function Td({ children, className, right, colSpan }: { children?: ReactNode; className?: string; right?: boolean; colSpan?: number }) {
  return <td colSpan={colSpan} className={cx("px-3 py-2.5 align-middle", right && "tnum text-right", className)}>{children}</td>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-3">{children}</div>;
}

/** Money respects field-level permissions (M27): without access it renders a lock. */
export function Money({ cents, currency = "ZAR", visible = true, compact }: { cents: number | null | undefined; currency?: string; visible?: boolean; compact?: boolean }) {
  if (!visible) return <span className="text-ink-3" title="Restricted to finance roles">•••</span>;
  return <span className="tnum">{formatMoney(cents, currency, { compact })}</span>;
}

export function Hours({ h }: { h: number | null | undefined }) {
  return <span className="tnum">{formatHours(h)}</span>;
}

export function Pct({ n }: { n: number | null | undefined }) {
  return <span className="tnum">{pct(n)}</span>;
}

export function Tabs({ tabs, active, base }: { tabs: { key: string; label: ReactNode }[]; active: string; base: string }) {
  return (
    <nav className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${base}${base.includes("?") ? "&" : "?"}tab=${t.key}`}
          className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm", active === t.key ? "border-brand font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function SourceNote({ sources, by }: { sources: string[]; by: string }) {
  return (
    <details className="mt-2 text-xs text-ink-3">
      <summary className="cursor-pointer">
        Drafted by 8gent ({by === "claude" ? "Claude" : "template"}) · {sources.length} sources · review before sending
      </summary>
      <ul className="mt-1 list-disc pl-5">
        {sources.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </details>
  );
}

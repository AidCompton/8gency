import { ArrowLeft, ArrowRight, CheckCircle, Tray, Warning, WarningCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatHours, formatMoney, pct } from "@/lib/domain/money";
import { LogoMark } from "./Logo";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && (
<BackLink href={back.href}>{back.label}</BackLink>
      )}
      <div className={cx("flex flex-wrap items-end justify-between gap-3", back && "mt-2")}>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <div className="mt-1 max-w-3xl text-sm text-ink-2">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean; id?: string }) {
  return (
    <section id={id} className={cx("rounded-xl border border-line bg-surface shadow-sm", className)}>
      {(title || actions) && (
        <div className="flex min-h-12 items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
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
    <div className={cx("h-full rounded-xl border border-line bg-surface p-4 shadow-sm transition-[border-color,box-shadow] duration-200", href && "group-hover:border-brand/40 group-hover:shadow-md")}>
      <div className="text-[13px] font-medium text-ink-2">{label}</div>
      <div className="tnum mt-1.5 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      {hint && (
        <div className={cx("mt-1.5 flex items-center gap-1 text-xs", tone === "critical" ? "text-critical-ink" : tone === "warning" ? "text-warning-ink" : tone === "good" ? "text-good-ink" : "text-ink-3")}>
          {tone && <StatusIcon tone={tone} />} <span>{hint}</span>
        </div>
      )}
    </div>
  );
  return href ? (
    <Link href={href} className="group block rounded-xl">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Decorative status icon; always next to text that states the status. Uses the *-ink colour so it reads on tints. */
export function StatusIcon({ tone, size = 14 }: { tone: "good" | "warning" | "critical"; size?: number }) {
  const Icon = tone === "good" ? CheckCircle : tone === "warning" ? Warning : WarningCircle;
  return <Icon aria-hidden size={size} weight="fill" className={cx("inline shrink-0 align-[-2px]", tone === "good" ? "text-good-ink" : tone === "warning" ? "text-warning-ink" : "text-critical-ink")} />;
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span aria-hidden className={cx("grid shrink-0 place-items-center rounded-full bg-brand/10 font-semibold text-brand", size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs")}>
      {initials}
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
  // Yellow is ~1.5:1 on the track in light mode; the inset edge gives the fill a visible boundary.
  const fill = state === "critical" ? "bg-critical" : state === "warning" ? "bg-warning shadow-[inset_0_0_0_1px_var(--warning-ink)]" : "bg-seq";
  const width = Math.min(100, ratio * 100);
  const desc = `${Math.round(ratio * 100)}% used${marker !== undefined && markerLabel ? ` · ${markerLabel} ${Math.round(marker * 100)}%` : ""}`;
  return (
    <div className="w-full" title={desc}>
      {(label || sublabel) && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate text-ink-2">{label}</span>
          <span className={cx("tnum shrink-0", state === "critical" ? "font-medium text-critical-ink" : state === "warning" ? "text-warning-ink" : "text-ink-2")}>
            {state === "critical" && <StatusIcon tone="critical" />} {sublabel ?? `${Math.round(ratio * 100)}%`}
            {state === "critical" && <span className="sr-only"> over</span>}
          </span>
        </div>
      )}
      <div role="img" aria-label={desc} className={cx("relative w-full rounded-full bg-track", compact ? "h-1.5" : "h-2")}>
        <div className={cx("h-full rounded-full", fill)} style={{ width: `${width}%` }} />
        {marker !== undefined && (
          <div className="absolute -top-1 h-[calc(100%+8px)] w-0.5 rounded bg-ink" style={{ left: `calc(${Math.min(100, marker * 100)}% - 1px)` }} />
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

/** Tone → tinted background + readable text. Shared by badges and icon tiles. */
export const TONE = {
  neutral: "bg-surface-2 text-ink-2",
  brand: "bg-brand/10 text-brand",
  good: "bg-good/10 text-good-ink",
  warning: "bg-warning/15 text-warning-ink",
  critical: "bg-critical/10 text-critical-ink",
  info: "bg-seq/10 text-seq-ink",
};
export type Tone = keyof typeof TONE;

export function Badge({ children, tone = "neutral", dot }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TONE[tone])}>
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
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
  queued: "neutral",
  failed: "critical",
};

export function HealthBadge({ band }: { band: string }) {
  const map: Record<string, [Tone, string]> = { healthy: ["good", "Healthy"], watch: ["warning", "Watch"], at_risk: ["critical", "At risk"], unknown: ["neutral", "No data yet"] };
  const [tone, label] = map[band] ?? map.unknown;
  return (
    <Badge tone={tone} dot={band in map && band !== "unknown"}>
      {label}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"} dot>
      {label.charAt(0).toUpperCase() + label.slice(1)}
    </Badge>
  );
}

const BTN = {
  primary: "bg-brand text-brand-ink shadow-[var(--elev-xs),inset_0_1px_0_rgb(255_255_255/0.14)] hover:bg-brand/90",
  secondary: "border border-line bg-surface text-ink shadow-xs hover:border-ink-3/40 hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "border border-critical/30 bg-surface text-critical-ink shadow-xs hover:border-critical/50 hover:bg-critical/10",
};

export function buttonClass(variant: keyof typeof BTN = "primary", size: "sm" | "md" = "md") {
  return cx("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px pointer-coarse:min-h-11 disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-wait", size === "sm" ? "px-2.5 py-1 text-sm" : "px-3.5 py-2 text-sm", BTN[variant]);
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
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  const hasRows = Array.isArray(children) ? children.flat().filter(Boolean).length > 0 : Boolean(children);
  return (
    // Focusable so keyboard users can scroll wide tables sideways.
    <div className="relative overflow-x-auto" tabIndex={0}>
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2/60 text-left text-xs font-medium text-ink-3">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2.5 font-medium first:pl-4 last:pr-4">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&>tr]:transition-colors [&>tr:hover]:bg-surface-2/50">{children}</tbody>
      </table>
      {!hasRows && empty && (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-ink-3">
          <Tray aria-hidden size={24} />
          {empty}
        </div>
      )}
    </div>
  );
}

export function Td({ children, className, right, colSpan }: { children?: ReactNode; className?: string; right?: boolean; colSpan?: number }) {
  return <td colSpan={colSpan} className={cx("px-3 py-2.5 align-middle first:pl-4 last:pr-4", right && "tnum text-right", className)}>{children}</td>;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-surface-2/30 px-4 py-8 text-center text-sm text-ink-3">
      <Tray aria-hidden size={22} />
      <div>{children}</div>
    </div>
  );
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
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${base}${base.includes("?") ? "&" : "?"}tab=${t.key}`}
          aria-current={active === t.key ? "page" : undefined}
          className={cx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors pointer-coarse:py-3",
            active === t.key ? "border-brand text-ink" : "border-transparent text-ink-3 hover:border-line hover:text-ink",
          )}
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

/** The 8gency product mark (public pages and auth). Agencies' own logos are used inside the app. */
export function ProductMark({ className, size = "md" }: { className?: string; size?: "md" | "lg" }) {
  const lg = size === "lg";
  return (
    <span className={cx("inline-flex items-center text-ink", lg ? "gap-3" : "gap-2.5", className)}>
      <span className="relative grid shrink-0">
        <span aria-hidden className="absolute -inset-1.5 rounded-[14px] bg-[#7b61ff] opacity-50 blur-[14px]" />
        <LogoMark size={lg ? 44 : 34} className="relative" />
      </span>
      <span className={cx("font-black leading-none tracking-[-0.06em]", lg ? "text-[31px]" : "text-[25px]")}>
        8gency<span aria-hidden className="text-brand">.</span>
      </span>
    </span>
  );
}

/** "← Invoices" style link back up the hierarchy. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-1 rounded text-sm text-ink-3 transition-colors hover:text-ink pointer-coarse:min-h-11">
      <ArrowLeft aria-hidden size={14} className="transition-transform group-hover:-translate-x-0.5" /> {children}
    </Link>
  );
}

/** "Full scan →" style link, for card actions and follow-ons. */
export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cx("group inline-flex items-center gap-1 rounded text-sm font-medium text-brand hover:underline pointer-coarse:min-h-11", className)}>
      {children}
      <ArrowRight aria-hidden size={14} className="transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

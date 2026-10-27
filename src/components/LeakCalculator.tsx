"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { estimateLeak, WORKING_WEEKS, type LeakInput } from "@/lib/domain/leak";
import { formatMoney } from "@/lib/domain/money";
import { Field, buttonClass } from "./ui";

const rand = (n: number) => formatMoney(n * 100, "ZAR", { compact: false }).replace(/,00$/, "");

const FIELDS: { key: keyof LeakInput; label: string; hint: string; suffix: string }[] = [
  { key: "people", label: "People who bill time", hint: "Including you, if you do client work.", suffix: "people" },
  { key: "rate", label: "Average rate", hint: "What you charge for an hour, before VAT.", suffix: "R / hour" },
  { key: "hoursPerWeek", label: "Client hours per person, per week", hint: "Not 40: the hours that are meant to be billable.", suffix: "hours" },
  { key: "unbilledPct", label: "Time that is never recorded or never invoiced", hint: "Most agencies guess 5 to 15%. Be honest.", suffix: "%" },
  { key: "creepHoursPerWeek", label: "Extra asks done without a change request", hint: "\"Can you just…\": across the whole agency, per week.", suffix: "hours / week" },
  { key: "retainerOverHoursPerMonth", label: "Hours delivered above your retainers", hint: "Across all retainer clients, per month.", suffix: "hours / month" },
];

export function LeakCalculator() {
  const [v, setV] = useState<LeakInput>({ people: 5, rate: 650, hoursPerWeek: 30, unbilledPct: 10, creepHoursPerWeek: 4, retainerOverHoursPerMonth: 12 });
  const r = useMemo(() => estimateLeak(v), [v]);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <form onSubmit={(e) => e.preventDefault()} className="space-y-5 rounded-2xl border border-line bg-surface p-6 shadow-sm" aria-label="Your agency">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            <div className="flex items-center gap-3">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={Number.isFinite(v[f.key]) ? v[f.key] : ""}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value === "" ? 0 : Number(e.target.value) })}
                className="max-w-40"
              />
              <span className="text-sm text-ink-3">{f.suffix}</span>
            </div>
          </Field>
        ))}
      </form>

      <aside aria-live="polite" className="h-fit space-y-5 rounded-2xl border border-brand/30 bg-brand/5 p-6 lg:sticky lg:top-6">
        <div>
          <p className="text-sm font-medium text-ink-2">Slipping away each year</p>
          <p className="tnum mt-1 text-4xl font-semibold tracking-tight text-ink">{rand(r.total)}</p>
        </div>
        <dl className="space-y-2.5 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-ink-2">Unrecorded or uninvoiced time</dt><dd className="tnum font-medium">{rand(r.unbilled)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-ink-2">Extra asks given away</dt><dd className="tnum font-medium">{rand(r.creep)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-ink-2">Retainer overservicing</dt><dd className="tnum font-medium">{rand(r.retainers)}</dd></div>
        </dl>
        <p className="border-t border-brand/20 pt-4 text-sm text-ink-2">
          Win back just a third and that is <b className="tnum text-ink">{rand(r.recoverable)}</b> a year, about <b className="tnum text-ink">{r.hoursRecoverable.toLocaleString("en-ZA")}</b> billable hours.
        </p>
        <Link href="/waitlist" className={buttonClass("primary") + " w-full"}>Find out where yours is</Link>
        <p className="text-xs leading-relaxed text-ink-3">
          An estimate from your own numbers, over {WORKING_WEEKS} working weeks a year. Nothing you type here is sent to us or stored.
          8gency measures the real figures from your jobs, time and invoices.
        </p>
      </aside>
    </div>
  );
}

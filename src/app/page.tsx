import type { Icon } from "@phosphor-icons/react";
import { ArrowRight, ChartLineUp, Coins, LinkSimple, MapPin, ShieldCheck, SunHorizon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Stagger } from "@/components/Motion";
import { ProductMark, buttonClass } from "@/components/ui";

const PROMISES: [Icon, string, string][] = [
  [ChartLineUp, "Shows you money in week one", "Import your projects, time and invoices. The Agency Health Scan puts a rand value on unbilled scope, overserviced retainers, unbilled time, late invoices and your least profitable clients."],
  [ShieldCheck, "Scope Guard", "Every task and hour is matched to what was sold. Out-of-scope work becomes a priced change request the client approves with one tap — or it's absorbed on the record, with a reason."],
  [LinkSimple, "Clients never need a login", "Approvals and feedback by secure link, email reply or WhatsApp. Every approval records who, which version, when and through which channel."],
  [SunHorizon, "Less admin, not more", "One My Day screen. Timesheets pre-filled from your own activity. Status reports and WIP summaries drafted for you to check."],
  [Coins, "Built around money", "Budget burn, retainer burn, margin and effective hourly rate sit one click from every job, client and task."],
  [MapPin, "Made for South African agencies", "Rand and multi-currency, VAT tax invoices, PO-number enforcement, POPIA-aware onboarding, WhatsApp as a first-class channel."],
];

export default function Landing() {
  return (
    <main className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] bg-[radial-gradient(50rem_24rem_at_50%_-10%,color-mix(in_srgb,var(--brand)_16%,transparent),transparent_70%)]" />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <ProductMark />
        <nav aria-label="Account" className="flex items-center gap-2">
          <Link href="/login" className={buttonClass("ghost")}>
            Log in
          </Link>
          <Link href="/waitlist" className={buttonClass("primary")}>
            Join the waitlist
          </Link>
        </nav>
      </header>
      <section className="relative mx-auto max-w-6xl px-4 pb-16 pt-12 text-center sm:px-6 sm:pt-24">
        <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-2 shadow-xs">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand" /> For advertising and marketing agencies of 5 to 50 people
        </p>
        <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">The operating system for your agency.</h1>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-ink-2">
          Staff, clients, work and money in one place. 8gency finds the work you're giving away, gets it priced and approved, and gets it invoiced.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/waitlist" className={buttonClass("primary") + " group h-11 px-5"}>
            Join the waitlist <ArrowRight aria-hidden size={16} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link href="/login" className={buttonClass("secondary") + " h-11 px-5"}>
            Log in
          </Link>
        </div>
      </section>
      <Stagger className="relative mx-auto grid max-w-6xl gap-4 px-4 pb-24 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        {PROMISES.map(([Icon, t, d]) => (
          <div key={t} data-stagger className="rounded-xl border border-line bg-surface p-6 shadow-sm">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand/10 text-brand">
              <Icon aria-hidden size={20} weight="bold" />
            </span>
            <h2 className="mt-4 font-semibold">{t}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{d}</p>
          </div>
        ))}
      </Stagger>
      <footer className="relative border-t border-line py-8 text-center text-xs text-ink-3">8gency · Phase 1 preview</footer>
    </main>
  );
}

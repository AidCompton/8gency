import type { Icon } from "@phosphor-icons/react";
import { ArrowRight, ChartLineUp, ChatsCircle, Coins, LinkSimple, ShieldCheck, SunHorizon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Stagger } from "@/components/Motion";
import { SiteShell } from "@/components/SiteShell";
import { buttonClass } from "@/components/ui";

export const metadata = {
  title: "8gency: know where your agency makes money, and where it loses it",
  description: "The operating system for marketing agencies: scope, time, billing and profit in one place, so unbilled work and overserviced retainers stop slipping away.",
};

const PROMISES: [Icon, string, string][] = [
  [ChartLineUp, "Shows you the money in week one", "Bring in your projects, time and invoices. 8gency puts a rand value on unbilled work, overserviced retainers, late invoices and your least profitable clients, then offers a one-click fix for each."],
  [ShieldCheck, "Every job has a scope", "Each task and hour is measured against what was sold. When a request goes beyond it, it becomes a priced change request the client can approve with one tap, or is absorbed on the record with a reason."],
  [Coins, "Profit, not just hours", "Budget burn, retainer burn, margin and effective hourly rate sit one click from every job, client and person."],
  [LinkSimple, "Clients never need a login", "Approvals and feedback by secure link. Every approval records who approved what, which version, and when."],
  [SunHorizon, "Less admin, not more", "One My Day screen, timesheets pre-filled from your own activity, a Monday summary of where the week stands, and a Friday nudge for gaps."],
  [ChatsCircle, "Your team talks where the work is", "Channels per client, project or department, direct messages, threads and kudos, linked to the jobs they are about."],
];

const STEPS: [string, string][] = [
  ["Run it beside what you use now", "For the first 30 days 8gency reads from your tools (Toggl and Trello to start) and changes nothing in them. Nothing goes to your clients."],
  ["Check the numbers against your own", "Every week we compare its figures with your books. When they match, you switch invoicing and email over."],
  ["Fix the leaks", "Draft the invoice for finished work, turn the extra asks into change requests, chase the overdue invoice, all from one screen."],
];

export default function Landing() {
  return (
    <SiteShell>
      <div className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] bg-[radial-gradient(50rem_24rem_at_50%_-10%,color-mix(in_srgb,var(--brand)_16%,transparent),transparent_70%)]" />
        <section className="relative mx-auto max-w-6xl px-4 pb-16 pt-10 text-center sm:px-6 sm:pt-20">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm font-medium text-ink-2 shadow-xs">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand" /> Made in South Africa, for marketing agencies of three people and up
          </p>
          <h1 className="mx-auto mt-6 max-w-4xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">Know where your agency makes money, and where it quietly loses it.</h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-ink-2">
            8gency brings scope, time, billing and profit into one place. It finds the work you are giving away, gets it priced and approved, and gets it invoiced.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/waitlist" className={buttonClass("primary") + " group min-h-11 px-5"}>
              Join the waitlist <ArrowRight aria-hidden size={16} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/leak-calculator" className={buttonClass("secondary") + " min-h-11 px-5"}>How much are you bleeding?</Link>
          </div>
        </section>

        <Stagger className="relative mx-auto grid max-w-6xl gap-4 px-4 pb-20 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
          {PROMISES.map(([Icon, t, d]) => (
            <div key={t} data-stagger className="rounded-xl border border-line bg-surface p-6 shadow-sm">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand/10 text-brand">
                <Icon aria-hidden size={20} weight="bold" />
              </span>
              <h2 className="mt-4 text-lg font-semibold">{t}</h2>
              <p className="mt-2 leading-relaxed text-ink-2">{d}</p>
            </div>
          ))}
        </Stagger>

        <section className="relative border-y border-line bg-surface-2/40 px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <h2 className="max-w-2xl text-balance text-3xl font-semibold tracking-tight">Start without risk</h2>
            <ol className="mt-8 grid gap-6 md:grid-cols-3">
              {STEPS.map(([t, d], i) => (
                <li key={t} className="flex gap-4">
                  <span className="tnum grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-brand-ink">{i + 1}</span>
                  <div><h3 className="font-semibold">{t}</h3><p className="mt-1 leading-relaxed text-ink-2">{d}</p></div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="relative mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
          <h2 className="text-balance text-3xl font-semibold tracking-tight">Your clients' data stays yours</h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg text-ink-2">
            We follow POPIA. We do not read what is inside your agency, and the email your clients receive is sent from your own address, never ours.
            Read the <Link href="/privacy" className="text-brand hover:underline">privacy policy</Link>.
          </p>
          <Link href="/waitlist" className={buttonClass("primary") + " mt-8 min-h-11 px-5"}>Join the waitlist</Link>
        </section>
      </div>
    </SiteShell>
  );
}

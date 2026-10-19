import Link from "next/link";
import { buttonClass } from "@/components/ui";

const PROMISES = [
  ["Shows you money in week one", "Import your projects, time and invoices. The Agency Health Scan puts a rand value on unbilled scope, overserviced retainers, unbilled time, late invoices and your least profitable clients."],
  ["Scope Guard", "Every task and hour is matched to what was sold. Out-of-scope work becomes a priced change request the client approves with one tap — or it's absorbed on the record, with a reason."],
  ["Clients never need a login", "Approvals and feedback by secure link, email reply or WhatsApp. Every approval records who, which version, when and through which channel."],
  ["Less admin, not more", "One My Day screen. Timesheets pre-filled from your own activity. Status reports and WIP summaries drafted for you to check."],
  ["Built around money", "Budget burn, retainer burn, margin and effective hourly rate sit one click from every job, client and task."],
  ["Made for South African agencies", "Rand and multi-currency, VAT tax invoices, PO-number enforcement, POPIA-aware onboarding, WhatsApp as a first-class channel."],
];

export default function Landing() {
  return (
    <main>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <span className="text-xl font-bold tracking-tight">8gency</span>
        <nav className="flex items-center gap-2">
          <Link href="/login" className={buttonClass("ghost")}>
            Log in
          </Link>
          <Link href="/signup" className={buttonClass("primary")}>
            Start free
          </Link>
        </nav>
      </header>
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:pt-20">
        <p className="mb-3 text-sm font-medium text-brand">For advertising and marketing agencies of 5 to 50 people</p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">The operating system for your agency.</h1>
        <p className="mt-5 max-w-2xl text-lg text-ink-2">
          Staff, clients, work and money in one place. 8gency finds the work you're giving away, gets it priced and approved, and gets it invoiced.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/signup" className={buttonClass("primary")}>
            Run your Agency Health Scan
          </Link>
          <Link href="/login" className={buttonClass("secondary")}>
            See the demo agency
          </Link>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 sm:grid-cols-2 lg:grid-cols-3">
        {PROMISES.map(([t, d]) => (
          <div key={t} className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-semibold">{t}</h2>
            <p className="mt-2 text-sm text-ink-2">{d}</p>
          </div>
        ))}
      </section>
      <footer className="border-t border-line py-8 text-center text-xs text-ink-3">8gency · Phase 1 preview</footer>
    </main>
  );
}

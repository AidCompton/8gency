import Link from "next/link";
import type { ReactNode } from "react";
import { SITE } from "@/lib/site";
import { ProductMark, buttonClass } from "./ui";

/** The public pages' frame: the same header and footer on the home page, the calculator and the legal pages. */
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Link href="/" aria-label="8gency home" className="rounded-lg"><ProductMark /></Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          <Link href="/leak-calculator" className={buttonClass("ghost") + " hidden sm:inline-flex"}>Leak calculator</Link>
          <Link href="/login" className={buttonClass("ghost")}>Log in</Link>
          <Link href="/waitlist" className={buttonClass("primary")}>Join the waitlist</Link>
        </nav>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-line px-4 py-8 text-sm text-ink-3 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <p>© {new Date().getFullYear()} {SITE.legalName}</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/leak-calculator" className="hover:text-ink hover:underline">Leak calculator</Link>
            <Link href="/privacy" className="hover:text-ink hover:underline">Privacy policy</Link>
            <Link href="/terms" className="hover:text-ink hover:underline">Terms of service</Link>
            <a href={`mailto:${SITE.email.hello}`} className="hover:text-ink hover:underline">{SITE.email.hello}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** A long-form page: title, when it changed, and the text in a readable column. */
export function Prose({ title, updated, draft, children }: { title: string; updated?: string; draft?: boolean; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 pb-20 pt-6 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      {updated && <p className="mt-2 text-sm text-ink-3">Last updated {updated}</p>}
      {draft && <p className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink-2"><b className="font-semibold text-warning-ink">Draft.</b> This text is being reviewed by our lawyer. It describes what we do today; it may change before it is final.</p>}
      <div className="mt-8 space-y-5 text-[1.0625rem] leading-relaxed text-ink-2 [&_a]:text-brand [&_a]:underline-offset-2 hover:[&_a]:underline [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-ink [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-ink [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_strong]:font-semibold [&_strong]:text-ink [&_table]:w-full [&_table]:text-left [&_table]:text-[0.9375rem] [&_td]:border-t [&_td]:border-line [&_td]:py-2.5 [&_td]:pr-4 [&_td]:align-top [&_th]:pb-2 [&_th]:pr-4 [&_th]:text-sm [&_th]:font-medium [&_th]:text-ink-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
        {children}
      </div>
    </article>
  );
}

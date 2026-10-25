import { CheckCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Suspense } from "react";
import { Flash } from "./Flash";
import { ProductMark } from "./ui";

const POINTS = ["Find the work you're giving away", "Turn out-of-scope asks into approved change requests", "Invoice every billable item, on time"];

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section aria-hidden className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_-10%_-10%,color-mix(in_srgb,var(--brand)_14%,transparent),transparent_60%)]" />
        <ProductMark size="lg" className="relative" />
        <div className="relative max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight">The operating system for your agency.</p>
          <ul className="mt-8 space-y-3 text-sm text-ink-2">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-2.5">
                <CheckCircle size={18} weight="fill" className="mt-px shrink-0 text-brand" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-ink-3">Made for agencies of 5 to 50 people.</p>
      </section>
      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 inline-flex rounded-lg lg:hidden">
            <ProductMark />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-ink-2">{subtitle}</p>}
          <div className="mt-6">
            <Suspense>
              <Flash />
            </Suspense>
            {children}
          </div>
          <p className="mt-6 text-sm text-ink-2">{footer}</p>
        </div>
      </section>
    </main>
  );
}

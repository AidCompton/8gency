import Link from "next/link";
import { Suspense } from "react";
import { Flash } from "./Flash";

export function AuthShell({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 block text-center text-xl font-bold tracking-tight">
          8gency
        </Link>
        <div className="rounded-2xl border border-line bg-surface p-6">
          <h1 className="mb-4 text-lg font-semibold">{title}</h1>
          <Suspense>
            <Flash />
          </Suspense>
          {children}
        </div>
        <p className="mt-4 text-center text-sm text-ink-2">{footer}</p>
      </div>
    </main>
  );
}

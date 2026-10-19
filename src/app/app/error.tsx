"use client";
import Link from "next/link";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-line bg-surface p-6 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-2">The error has been logged. Try again, or go back to My Day.</p>
      <div className="mt-4 flex justify-center gap-2">
        <button onClick={reset} className="rounded-lg border border-line px-3 py-1.5 text-sm">Try again</button>
        <Link href="/app/my-day" className="rounded-lg bg-brand px-3 py-1.5 text-sm text-brand-ink">My Day</Link>
      </div>
    </div>
  );
}

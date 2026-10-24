"use client";
import { WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-line bg-surface p-8 text-center shadow-sm">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-critical/10 text-critical-ink">
        <WarningCircle aria-hidden size={24} />
      </span>
      <h1 className="mt-4 text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-2">The error has been logged. Try again, or go back to My Day.</p>
      <div className="mt-6 flex justify-center gap-2">
        <button type="button" onClick={reset} className={buttonClass("secondary")}>
          Try again
        </button>
        <Link href="/app/my-day" className={buttonClass("primary")}>
          My Day
        </Link>
      </div>
    </div>
  );
}

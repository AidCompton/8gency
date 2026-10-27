"use client";
import type { ReactNode } from "react";

/** A form that saves as soon as a switch or field inside it changes. */
export function AutoForm({ action, children, className }: { action: (fd: FormData) => void | Promise<void>; children: ReactNode; className?: string }) {
  return (
    <form action={action} onChange={(e) => e.currentTarget.requestSubmit()} className={className}>
      {children}
    </form>
  );
}

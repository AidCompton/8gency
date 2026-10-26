"use client";
import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

/**
 * Submit button for server-action forms. While the action runs every submit
 * button in the form is disabled, so nothing is sent twice. `confirm` asks
 * first, for actions that can't be undone. Each press also sets an idempotency key.
 */
export function SubmitButton({ confirm, disabled, onClick, ...props }: ComponentProps<"button"> & { confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      {...props}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
        // One key per press: if the same press reaches the server twice, the action runs once (see act() in lib/actions.ts).
        else document.cookie = `8g_idem=${crypto.randomUUID()}; path=/; max-age=120; samesite=lax`;
        onClick?.(e);
      }}
    />
  );
}

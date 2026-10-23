"use client";
import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

/**
 * Submit button for server-action forms. While the action runs every submit
 * button in the form is disabled, so nothing is sent twice. `confirm` asks
 * first, for actions that can't be undone.
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
        onClick?.(e);
      }}
    />
  );
}

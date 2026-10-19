"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function Flash() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const error = sp.get("error");
  const ok = sp.get("ok");
  if (!error && !ok) return null;
  const dismiss = () => {
    const next = new URLSearchParams(sp.toString());
    next.delete("error");
    next.delete("ok");
    router.replace(next.size ? `${path}?${next}` : path, { scroll: false });
  };
  return (
    <div
      role={error ? "alert" : "status"}
      className={`mb-4 flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
        error ? "border-critical/40 bg-critical/10 text-critical-ink" : "border-good/40 bg-good/10 text-good-ink"
      }`}
    >
      <span>{error ?? ok}</span>
      <button type="button" onClick={dismiss} className="text-xs opacity-70 hover:opacity-100" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

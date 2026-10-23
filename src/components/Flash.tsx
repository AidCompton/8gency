"use client";
import { CheckCircle, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function Flash() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const error = sp.get("error");
  const ok = sp.get("ok");
  const dismiss = () => {
    const next = new URLSearchParams(sp.toString());
    next.delete("error");
    next.delete("ok");
    router.replace(next.size ? `${path}?${next}` : path, { scroll: false });
  };
  // Success messages clear themselves; errors stay until dismissed.
  useEffect(() => {
    if (!ok || error) return;
    const t = setTimeout(dismiss, 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, error]);
  if (!error && !ok) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={`no-print mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-sm ${
        error ? "border-critical/30 bg-critical/10 text-critical-ink" : "border-good/30 bg-good/10 text-good-ink"
      }`}
    >
      {error ? <WarningCircle aria-hidden size={18} weight="fill" className="mt-px shrink-0" /> : <CheckCircle aria-hidden size={18} weight="fill" className="mt-px shrink-0" />}
      <span className="flex-1 font-medium">{error ?? ok}</span>
      <button type="button" onClick={dismiss} className="-m-1 grid h-7 w-7 place-items-center rounded-md opacity-70 transition hover:bg-current/10 hover:opacity-100 pointer-coarse:h-11 pointer-coarse:w-11" aria-label="Dismiss">
        <X aria-hidden size={14} weight="bold" />
      </button>
    </div>
  );
}

"use client";
import { Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";
import { buttonClass } from "./ui";

/** A read-only value with a Copy button. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard?.writeText(value).catch(() => {});
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        }}
        className={buttonClass("secondary") + " shrink-0"}
      >
        {done ? <Check aria-hidden size={16} /> : <Copy aria-hidden size={16} />} {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

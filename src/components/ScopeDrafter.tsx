"use client";
import { MagicWand, Plus, Trash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { draftScopeAction, saveScopeDraftAction } from "@/app/app/_actions/jobs";
import type { DraftItem } from "@/lib/domain/scopeDraft";
import type { ScopeDraft } from "@/lib/services/scopeDraft";
import { buttonClass, cx } from "./ui";

/**
 * Paste a quote or email, get the scope items drafted, fix them up, then save.
 * A person confirms every line: nothing becomes scope until they press the button.
 */
export function ScopeDrafter({ jobId, aiOn }: { jobId: string; aiOn: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<ScopeDraft | null>(null);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const make = () =>
    start(async () => {
      setError("");
      const r = await draftScopeAction(jobId, text);
      if (r.error || !r.draft) return setError(r.error ?? "Couldn't draft that.");
      setDraft(r.draft);
      setItems(r.draft.items);
    });
  const save = () =>
    start(async () => {
      setError("");
      const r = await saveScopeDraftAction(jobId, items);
      if (r.error) return setError(r.error);
      setDraft(null);
      setItems([]);
      setText("");
      router.refresh();
    });
  const set = (i: number, patch: Partial<DraftItem>) => setItems((cur) => cur.map((x, n) => (n === i ? { ...x, ...patch } : x)));

  return (
    <div className="rounded-xl border border-brand/30 bg-brand/5 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><MagicWand aria-hidden size={16} className="text-brand" /> Draft the scope from your quote</h3>
      {!draft ? (
        <div className="mt-2 space-y-3">
          <p className="text-xs text-ink-2">
            Paste the quote, SOW or email that says what was sold. You'll check and edit every line before it's saved.{" "}
            {aiOn ? "8gent AI reads it; the text is sent to Claude, our AI provider, and isn't used for training." : "It's read by simple rules. Turn on 8gent AI in Settings for messier text."}
          </p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={12000} placeholder={"6 social statics, 2 rounds each\n1 campaign video (30s)\n40 hours of community management\nExcludes: talent and music licences"} aria-label="Quote text" />
          <button type="button" onClick={make} disabled={pending || text.trim().length < 5} className={buttonClass("primary", "sm")}>{pending ? "Reading…" : "Draft the scope"}</button>
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <p className="text-xs text-ink-2">{draft.generatedBy === "ai" ? "Drafted by 8gent AI. Check every line against the quote." : draft.note ?? "Drafted by rules. Check every line against the quote."}</p>
          <ul className="space-y-3">
            {items.map((it, i) => (
              <li key={i} className="grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_110px_80px_80px_auto]">
                <input value={it.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Item" className="field-sm sm:col-span-1" />
                <select value={it.unit} onChange={(e) => set(i, { unit: e.target.value as DraftItem["unit"], rounds_allowed: e.target.value === "hours" ? 0 : it.rounds_allowed || 2 })} aria-label="Unit" className="field-sm"><option value="deliverable">Deliverable</option><option value="hours">Hours</option></select>
                <input type="number" min={0.25} step={0.25} value={it.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} aria-label="Quantity" className="field-sm" />
                <input type="number" min={0} max={10} value={it.rounds_allowed} disabled={it.unit === "hours"} onChange={(e) => set(i, { rounds_allowed: Number(e.target.value) })} aria-label="Rounds each" title="Review rounds each" className={cx("field-sm", it.unit === "hours" && "opacity-40")} />
                <button type="button" onClick={() => setItems((cur) => cur.filter((_, n) => n !== i))} aria-label={`Remove ${it.name}`} className="grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:bg-critical/10 hover:text-critical-ink"><Trash aria-hidden size={15} /></button>
                <input value={it.inclusions} onChange={(e) => set(i, { inclusions: e.target.value })} placeholder="Includes" aria-label="Inclusions" className="field-sm sm:col-span-2" />
                <input value={it.exclusions} onChange={(e) => set(i, { exclusions: e.target.value })} placeholder="Excludes" aria-label="Exclusions" className="field-sm sm:col-span-3" />
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setItems((cur) => [...cur, { name: "", unit: "deliverable", quantity: 1, rounds_allowed: 2, inclusions: "", exclusions: "" }])} className={buttonClass("ghost", "sm")}><Plus aria-hidden size={14} /> Add a line</button>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={pending || !items.length} className={buttonClass("primary", "sm")}>{pending ? "Saving…" : `Save ${items.length} ${items.length === 1 ? "item" : "items"} to the scope`}</button>
            <button type="button" onClick={() => setDraft(null)} className={buttonClass("ghost", "sm")}>Start over</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-critical-ink">{error}</p>}
    </div>
  );
}

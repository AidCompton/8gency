import Anthropic from "@anthropic-ai/sdk";
import type { Tx } from "../db";
import { itemsFromModelText, parseScopeText, type DraftItem } from "../domain/scopeDraft";
import { agencySettings, UserError } from "./core";
import { addScopeItem } from "./scope";

// Drafting a job's scope from the text of a quote. The text is sent to Claude only
// when the agency has switched 8gent AI on; otherwise (or if the AI is unavailable)
// the rules reader does the job. Nothing is saved until a person has reviewed the lines.

const MODEL = "claude-opus-5-5";
const MAX_TEXT = 12_000;

export interface ScopeDraft {
  items: DraftItem[];
  generatedBy: "ai" | "rules";
  /** Why the rules reader was used, when a person might have expected the AI. */
  note?: string;
}

const SYSTEM = `You turn the text of an agency's quote or statement of work into a scope baseline.
Reply with JSON only, in this shape: {"items":[{"name":string,"unit":"deliverable"|"hours","quantity":number,"rounds_allowed":number,"inclusions":string,"exclusions":string}]}
One item per deliverable that was sold, or per bank of hours. Use unit "hours" only for time-based items, with rounds_allowed 0.
Take quantities, review rounds, inclusions and exclusions only from the text. If the text doesn't say, use quantity 1 and 2 rounds, and leave inclusions and exclusions empty.
Never include prices, totals, taxes, payment terms or greetings. Keep names short. Do not invent items.`;

async function askClaude(text: string): Promise<DraftItem[] | null> {
  try {
    const client = new Anthropic();
    const res = await client.messages.create({ model: MODEL, max_tokens: 3000, system: SYSTEM, messages: [{ role: "user", content: text }] });
    if (res.stop_reason === "refusal") return null;
    const reply = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    return itemsFromModelText(reply);
  } catch (e) {
    console.error("scope draft: Claude call failed", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
    return null;
  }
}

export async function draftScope(tx: Tx, jobId: string, textIn: string): Promise<ScopeDraft> {
  const text = textIn.trim();
  if (text.length < 5) throw new UserError("Paste the text of the quote or email first.");
  if (text.length > MAX_TEXT) throw new UserError(`That's too long (over ${MAX_TEXT.toLocaleString("en-ZA")} characters). Paste just the part that lists what was sold.`);
  const job = await tx.one<{ scope_locked_at: Date | null }>("select scope_locked_at from jobs where id = $1", [jobId]);
  if (!job) throw new UserError("Job not found.");
  if (job.scope_locked_at) throw new UserError("The scope baseline is approved and locked. Add to it with a change request.");

  const settings = await agencySettings(tx);
  let note: string | undefined;
  if (settings.ai_enabled && process.env.ANTHROPIC_API_KEY) {
    const items = await askClaude(text);
    if (items?.length) {
      await tx.audit("scope.drafted", "job", jobId, undefined, { by: "ai", characters: text.length, items: items.length });
      return { items, generatedBy: "ai" };
    }
    note = "The AI couldn't read that, so this was drafted by rules. Check every line.";
  } else if (!settings.ai_enabled) {
    note = "Drafted by rules. Turn on 8gent AI in Settings for messier text.";
  }
  const items = parseScopeText(text);
  await tx.audit("scope.drafted", "job", jobId, undefined, { by: "rules", characters: text.length, items: items.length });
  if (!items.length) throw new UserError("We couldn't find anything that looks like a deliverable in that text. Add the scope items by hand below.");
  return { items, generatedBy: "rules", note };
}

/** Save the reviewed lines as the job's draft scope. */
export async function saveScopeDraft(tx: Tx, jobId: string, items: DraftItem[]) {
  const job = await tx.one<{ company_id: string }>("select company_id from jobs where id = $1", [jobId]);
  if (!job) throw new UserError("Job not found.");
  if (!items.length) throw new UserError("There's nothing to add.");
  for (const i of items) await addScopeItem(tx, { company_id: job.company_id, job_id: jobId, name: i.name, unit: i.unit, quantity: i.quantity, rounds_allowed: i.rounds_allowed, inclusions: i.inclusions, exclusions: i.exclusions });
  await tx.audit("scope.draft_saved", "job", jobId, undefined, { items: items.length });
}

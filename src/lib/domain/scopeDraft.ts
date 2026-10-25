// Turning the text of a quote or SOW into scope items. The rules reader works with
// no AI at all and is the fallback; the AI path (services/scopeDraft.ts) returns the
// same shape. Either way a person reviews every line before it becomes scope.

export interface DraftItem {
  name: string;
  unit: "deliverable" | "hours";
  quantity: number;
  rounds_allowed: number;
  inclusions: string;
  exclusions: string;
}

const NOISE = /\b(total|sub-?total|vat|tax|payment|terms|deposit|banking|bank details|valid for|valid until|thank|regards|dear|invoice|quote number|quotation|signed|signature|date|page \d)\b/i;
const PRICE = /(?:R|ZAR|\$|€|£)\s?\d[\d\s,.]*(?:\s?(?:excl|incl|ex|inc)\.?\s?(?:vat)?)?/gi;

const clean = (s: string) => s.replace(PRICE, " ").replace(/\s{2,}/g, " ").replace(/^[\s\-–—:;,.]+|[\s\-–—:;,.]+$/g, "").trim();

/** Make any item (from rules or from AI) safe to show and save: sane lengths, numbers and units. */
export function sanitiseItem(i: Partial<DraftItem> & { name?: unknown }): DraftItem | null {
  const name = clean(String(i.name ?? "")).slice(0, 160);
  if (name.length < 2) return null;
  const unit = i.unit === "hours" ? "hours" : "deliverable";
  const quantity = Math.min(1000, Math.max(0.25, Math.round(Number(i.quantity) * 100) / 100 || 1));
  const rounds = unit === "hours" ? 0 : Math.min(10, Math.max(0, Math.round(Number(i.rounds_allowed ?? 2))));
  return { name, unit, quantity, rounds_allowed: Number.isFinite(rounds) ? rounds : 2, inclusions: String(i.inclusions ?? "").trim().slice(0, 300), exclusions: String(i.exclusions ?? "").trim().slice(0, 300) };
}

export function parseScopeText(text: string): DraftItem[] {
  const items: DraftItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-•*·–—✓✔]|\d+[.)]|\(?[a-z][.)])\s+/i, "").trim();
    if (line.length < 3 || line.length > 240) continue;
    const ex = line.match(/^(?:exclud(?:es|ed|ing)|not included|excl\.?)\s*[:\-]?\s*(.+)$/i);
    const inc = line.match(/^(?:includ(?:es|ed|ing)|incl\.?)\s*[:\-]?\s*(.+)$/i);
    const last = items[items.length - 1];
    if (ex && last) {
      last.exclusions = [last.exclusions, clean(ex[1])].filter(Boolean).join("; ").slice(0, 300);
      continue;
    }
    if (inc && last) {
      last.inclusions = [last.inclusions, clean(inc[1])].filter(Boolean).join("; ").slice(0, 300);
      continue;
    }
    if (NOISE.test(line) || /^[\d\s.,R%-]+$/.test(line)) continue;

    const rounds = line.match(/(\d+)\s*(?:rounds?|revisions?|amends?|rounds? of (?:changes|feedback|edits))/i);
    const hours = line.match(/^(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|h)\b\s*(?:of\s+|for\s+|-\s*)?(.*)$/i);
    const count = line.match(/^(\d+(?:[.,]\d+)?)\s*(?:x|×)?\s+(.+)$/i);
    const trailing = line.match(/^(.+?)\s*(?:x|×)\s*(\d+)\b/i);
    let item: Partial<DraftItem> | null = null;
    if (hours) item = { name: hours[2] || "Hours", unit: "hours", quantity: Number(hours[1].replace(",", ".")), rounds_allowed: 0 };
    else if (count && !/^\d{4}\b/.test(line)) item = { name: count[2], unit: "deliverable", quantity: Number(count[1].replace(",", ".")), rounds_allowed: rounds ? Number(rounds[1]) : 2 };
    else if (trailing) item = { name: trailing[1], unit: "deliverable", quantity: Number(trailing[2]), rounds_allowed: rounds ? Number(rounds[1]) : 2 };
    else item = { name: line, unit: "deliverable", quantity: 1, rounds_allowed: rounds ? Number(rounds[1]) : 2 };
    if (item.name) item.name = item.name.replace(/\(?\d+\s*(?:rounds?|revisions?|amends?)[^)]*\)?/gi, "");
    const clean1 = sanitiseItem(item);
    if (clean1) items.push(clean1);
    if (items.length >= 30) break;
  }
  return items;
}

/** Pull the first JSON object out of a model reply, even if it wrapped it in a code fence or a sentence. */
export function itemsFromModelText(text: string): DraftItem[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return null;
    const out = parsed.items.map((i) => sanitiseItem((i ?? {}) as Partial<DraftItem>)).filter((i): i is DraftItem => Boolean(i));
    return out.slice(0, 30);
  } catch {
    return null;
  }
}

// M11 Scope Guard heuristics. These run on every client request and message
// (SC-01, SC-07). They are deliberately transparent: each flag lists the phrase
// that triggered it, so the account manager can see why (8gent rule 3).

import { firstName } from "./text";

const OOS_SIGNALS: { pattern: RegExp; label: string; weight: number }[] = [
  { pattern: /\bcan (you|we) (also|just)\b/i, label: "“can you also…”", weight: 35 },
  { pattern: /\bcould (you|we) (also|just)\b/i, label: "“could you also…”", weight: 35 },
  { pattern: /\b(quick|small|tiny|little) (one|favour|favor|thing|change|tweak|job)\b/i, label: "“quick one / small favour”", weight: 35 },
  { pattern: /\bwhile you'?re at it\b/i, label: "“while you're at it”", weight: 40 },
  { pattern: /\b(one|a few) more\b/i, label: "“one more…”", weight: 20 },
  { pattern: /\b(another|extra|additional|new) (version|size|format|banner|post|video|page|concept|option|round|language)s?\b/i, label: "extra version / asset", weight: 30 },
  { pattern: /\b(resize|re-?size|adapt|cut ?downs?)\b/i, label: "resizes or adaptations", weight: 20 },
  { pattern: /\b(also need|we'?ll need|we need) (a|an|some|the)\b/i, label: "new need stated", weight: 20 },
  { pattern: /\b(translate|translation)\b/i, label: "translation", weight: 20 },
  { pattern: /\b(by|for) (tomorrow|tonight|end of day|eod|first thing)\b/i, label: "rush timing", weight: 15 },
  { pattern: /\b(urgent(ly)?|asap|rush)\b/i, label: "urgency", weight: 10 },
  { pattern: /\b(start(ing)? from scratch|completely different|new direction|rethink)\b/i, label: "new creative direction", weight: 30 },
  { pattern: /\bnot in the (brief|scope)\b/i, label: "acknowledged as outside brief", weight: 40 },
];

export interface OOSResult {
  score: number;
  signals: string[];
  likely: boolean;
}

export function detectOutOfScope(text: string): OOSResult {
  let score = 0;
  const signals: string[] = [];
  for (const s of OOS_SIGNALS) {
    if (s.pattern.test(text)) {
      score += s.weight;
      signals.push(s.label);
    }
  }
  score = Math.min(100, score);
  return { score, signals, likely: score >= 30 };
}

// PR-04: vague scope wording means nothing is ever out of scope.
const VAGUE_SCOPE: { pattern: RegExp; suggestion: string }[] = [
  { pattern: /\bongoing( support)?\b/i, suggestion: "State hours per month or a number of requests" },
  { pattern: /\bas (required|needed|necessary)\b/i, suggestion: "Replace with a quantity and a cap" },
  { pattern: /\bad[- ]hoc\b/i, suggestion: "Set a monthly hours bank for ad-hoc work" },
  { pattern: /\bunlimited\b/i, suggestion: "Cap the quantity or the rounds" },
  { pattern: /\bmanagement\b/i, suggestion: "Say what is managed: e.g. “3 platforms, 12 posts, 1 report”" },
  { pattern: /\b(general|misc(ellaneous)?|various)\b/i, suggestion: "List the specific deliverables" },
  { pattern: /\bincluding but not limited to\b/i, suggestion: "List what is included; everything else is excluded" },
];

export function findVagueScope(text: string): { phrase: string; suggestion: string }[] {
  const out: { phrase: string; suggestion: string }[] = [];
  for (const v of VAGUE_SCOPE) {
    const m = text.match(v.pattern);
    if (m) out.push({ phrase: m[0], suggestion: v.suggestion });
  }
  return out;
}

export interface ScopeUsage {
  quantity: number;
  used: number;
}

/** Scope meter state: used, remaining, over. */
export function scopeMeter({ quantity, used }: ScopeUsage) {
  const remaining = Math.max(0, quantity - used);
  const over = Math.max(0, used - quantity);
  const ratio = quantity > 0 ? used / quantity : used > 0 ? Infinity : 0;
  const state: "ok" | "warn" | "over" = ratio > 1 ? "over" : ratio >= 0.9 ? "warn" : "ok";
  return { remaining, over, ratio, state };
}

/** Rounds counter (M10): the next client round beyond the allowance needs a change request. */
export function nextRoundNeedsChangeRequest(roundsUsed: number, roundsAllowed: number): boolean {
  return roundsUsed >= roundsAllowed;
}

/** Default polite wording for the money conversation (SC-06). */
export function changeRequestMessage(opts: {
  contactName: string;
  title: string;
  description: string;
  hours: number;
  price: string;
  agencyName: string;
  senderName: string;
}): string {
  const first = firstName(opts.contactName) || "there";
  return [
    `Hi ${first},`,
    ``,
    `Thanks for the request: “${opts.title}”. It sits outside what we agreed for this piece of work, so before we start we want to confirm the cost with you.`,
    ``,
    opts.description ? `What it includes: ${opts.description}` : ``,
    `Estimate: ${opts.hours} hours, ${opts.price} (excl. VAT).`,
    ``,
    `If you're happy for us to go ahead, approve it with one click below. If you'd rather keep to the original scope, decline and nothing changes.`,
    ``,
    `Thanks,`,
    `${opts.senderName}, ${opts.agencyName}`,
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
}

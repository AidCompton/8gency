// Parse client replies arriving by email or WhatsApp (M06, CR-01). A reply
// carries a short reference code we put in the outgoing message.

export type ReplyDecision = "approved" | "changes_requested" | "declined" | "comment";

export interface ParsedReply {
  code: string | null;
  decision: ReplyDecision;
  body: string;
}

// Six characters, no 0/O/1/I, always at least one digit and one letter.
const CODE = /\b((?=[A-Z2-9]*[2-9])(?=[A-Z2-9]*[A-Z])[A-HJ-NP-Z2-9]{6})\b/;

export function parseReply(raw: string): ParsedReply {
  // Drop quoted history from email replies.
  const text = raw
    .split(/\r?\n/)
    .filter((l) => !l.startsWith(">"))
    .join("\n")
    .split(/\n\s*On .+wrote:\s*\n/)[0]
    .trim();
  const code = text.toUpperCase().match(CODE)?.[1] ?? null;
  const first = text.replace(CODE, "").trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z👍✅]/g, "") ?? "";
  let decision: ReplyDecision = "comment";
  if (/^(approve|approved|yes|ok|okay|go|👍|✅)$/.test(first) || /\bapproved?\b/i.test(text.split("\n")[0] ?? "")) decision = "approved";
  if (/^(decline|declined|no|reject|rejected)$/.test(first)) decision = "declined";
  if (/^(changes?|amend|amends|revise|feedback)$/.test(first)) decision = "changes_requested";
  const body = text.replace(CODE, "").replace(/^\s*(approve[d]?|changes?|decline[d]?|feedback|amends?)\s*[:\-]?\s*/i, "").trim();
  return { code, decision, body };
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeReferenceCode(random: (n: number) => Uint8Array): string {
  for (;;) {
    const code = Array.from(random(6), (b) => ALPHABET[b % ALPHABET.length]).join("");
    if (/[2-9]/.test(code) && /[A-Z]/.test(code)) return code;
  }
}

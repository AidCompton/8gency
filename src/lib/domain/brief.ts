// M07 brief completeness score (ON-02, PM-09). Work cannot start below the
// agency's threshold without a recorded override.

export interface BriefFields {
  objective?: string | null;
  audience?: string | null;
  key_message?: string | null;
  deliverables?: string | null;
  must_haves?: string | null;
  budget?: string | null;
  deadline?: string | null;
  approver_contact_id?: string | null;
  success_measure?: string | null;
}

export const BRIEF_FIELDS: { key: keyof BriefFields; label: string; weight: number; minLength: number; question: string }[] = [
  { key: "objective", label: "Objective", weight: 16, minLength: 20, question: "What must this work achieve for the business, and how will we know?" },
  { key: "audience", label: "Audience", weight: 12, minLength: 12, question: "Who exactly are we talking to? Age, situation, what they believe today." },
  { key: "key_message", label: "Key message", weight: 10, minLength: 10, question: "What is the one thing the audience should take away?" },
  { key: "deliverables", label: "Deliverables", weight: 14, minLength: 5, question: "Which assets do you need, in which sizes and formats?" },
  { key: "must_haves", label: "Must-haves", weight: 8, minLength: 5, question: "Anything mandatory? Logos, legal lines, product shots, claims, disclaimers." },
  { key: "budget", label: "Budget", weight: 10, minLength: 1, question: "What budget is approved for this, including production and media?" },
  { key: "deadline", label: "Deadline", weight: 10, minLength: 1, question: "When must this be live, and is that date fixed?" },
  { key: "approver_contact_id", label: "Named approver", weight: 12, minLength: 1, question: "Who on your side signs this off?" },
  { key: "success_measure", label: "Success measure", weight: 8, minLength: 5, question: "Which number tells us this worked?" },
];

const VAGUE = /^(tbc|tbd|n\/?a|asap|see (email|deck|attached)|\?+|-+|none|various|etc\.?)$/i;

export function isFieldComplete(value: string | null | undefined, minLength: number): boolean {
  const v = (value ?? "").trim();
  if (!v || VAGUE.test(v)) return false;
  return v.length >= minLength;
}

export function scoreBrief(b: BriefFields): { score: number; missing: typeof BRIEF_FIELDS } {
  let score = 0;
  const missing: typeof BRIEF_FIELDS = [];
  for (const f of BRIEF_FIELDS) {
    if (isFieldComplete(b[f.key] as string | null, f.minLength)) score += f.weight;
    else missing.push(f);
  }
  return { score, missing };
}

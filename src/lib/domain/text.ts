/** First name for greetings, skipping honorifics: "Dr Priya Govender" → "Priya". */
export function firstName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const honorific = /^(dr|mr|mrs|ms|miss|mx|prof|professor|adv|rev|sir|dame)\.?$/i;
  return parts.find((p) => !honorific.test(p)) ?? parts[0] ?? "there";
}

/** Short title from free text: first sentence, cut on a word boundary. */
export function summarise(text: string, max = 60): string {
  const first = text.trim().split(/(?<=[.!?])\s|\n/)[0] ?? "";
  const clean = (first.length >= 12 ? first : text.trim()).replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max / 2 ? cut.lastIndexOf(" ") : cut.length).replace(/[,;:\-–]$/, "")}…`;
}

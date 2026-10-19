/** First name for greetings, skipping honorifics: "Dr Priya Govender" → "Priya". */
export function firstName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const honorific = /^(dr|mr|mrs|ms|miss|mx|prof|professor|adv|rev|sir|dame)\.?$/i;
  return parts.find((p) => !honorific.test(p)) ?? parts[0] ?? "there";
}

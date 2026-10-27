// Consistent job numbers (PM-02), e.g. ACME-2026-0007.

export function formatJobNumber(format: string, parts: { client: string; year: number; seq: number }): string {
  return format
    .replace(/\{CLIENT\}/g, parts.client.toUpperCase())
    .replace(/\{YYYY\}/g, String(parts.year))
    .replace(/\{YY\}/g, String(parts.year).slice(-2))
    .replace(/\{SEQ\}/g, String(parts.seq).padStart(4, "0"));
}

/** Derive a short client code from a company name: "Blue Crane Brewing" → "BCB". */
export function suggestClientCode(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const stop = new Set(["the", "and", "of", "pty", "ltd", "inc", "co"]);
  const meaningful = words.filter((w) => !stop.has(w.toLowerCase()));
  const base = meaningful.length >= 2 ? meaningful.map((w) => w[0]).join("") : (meaningful[0] ?? "CLI").slice(0, 4);
  return base.toUpperCase().slice(0, 5) || "CLI";
}

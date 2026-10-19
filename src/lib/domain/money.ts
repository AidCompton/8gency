// Money is stored as integer cents with its currency. Never use floats for totals.

export function formatMoney(cents: number | null | undefined, currency = "ZAR", opts: { compact?: boolean } = {}): string {
  const value = (cents ?? 0) / 100;
  const symbol = currency === "ZAR" ? "R" : undefined;
  if (opts.compact && Math.abs(value) >= 10_000) {
    const s = new Intl.NumberFormat("en-ZA", { notation: "compact", maximumFractionDigits: 1 }).format(value);
    return symbol ? `${symbol}${s}` : `${currency} ${s}`;
  }
  const s = new Intl.NumberFormat("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value));
  const sign = value < 0 ? "-" : "";
  return symbol ? `${sign}${symbol}${s}` : `${sign}${currency} ${s}`;
}

/** Parse a user-typed amount ("12,500.50", "R 1 200") into cents. */
export function toCents(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === "") return 0;
  if (typeof input === "number") return Math.round(input * 100);
  const cleaned = input.replace(/[^0-9.\-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export interface LineInput {
  quantity: number;
  unit_cents: number;
}

export function lineAmount(l: LineInput): number {
  return Math.round(l.quantity * l.unit_cents);
}

/** Subtotal, tax and total for an invoice. Tax is rounded once, on the subtotal. */
export function invoiceTotals(lines: LineInput[], taxRate: number) {
  const subtotal = lines.reduce((s, l) => s + lineAmount(l), 0);
  const tax = Math.round(subtotal * taxRate);
  return { subtotal_cents: subtotal, tax_cents: tax, total_cents: subtotal + tax };
}

export function formatHours(h: number | null | undefined): string {
  const v = h ?? 0;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}h`;
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

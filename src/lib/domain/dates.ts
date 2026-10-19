// Date helpers that work on YYYY-MM-DD strings, so calendar dates never drift
// across time zones.

export type ISODate = string;

export function todayIn(timeZone = "Africa/Johannesburg", now = new Date()): ISODate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function parse(d: ISODate): Date {
  return new Date(`${d}T00:00:00Z`);
}

export function fmt(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fmt(x);
}

export function addMonths(d: ISODate, n: number): ISODate {
  const x = parse(d);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return fmt(x);
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}

/** Monday of the week containing d. */
export function startOfWeek(d: ISODate): ISODate {
  const dow = parse(d).getUTCDay(); // 0 = Sunday
  return addDays(d, dow === 0 ? -6 : 1 - dow);
}

export function startOfMonth(d: ISODate): ISODate {
  return `${d.slice(0, 7)}-01`;
}

export function endOfMonth(d: ISODate): ISODate {
  return addDays(addMonths(startOfMonth(d), 1), -1);
}

export function isWeekday(d: ISODate): boolean {
  const dow = parse(d).getUTCDay();
  return dow !== 0 && dow !== 6;
}

/** Working days (Mon–Fri) from a to b inclusive. Public holidays are subtracted by the caller. */
export function workingDays(a: ISODate, b: ISODate): number {
  let n = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) if (isWeekday(d)) n++;
  return n;
}

export function formatDate(d: ISODate | null | undefined): string {
  if (!d) return "—";
  return parse(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatShort(d: ISODate | null | undefined): string {
  if (!d) return "—";
  return parse(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "3d 4h" style duration since a timestamp, used for the waiting-on-client clock. */
export function ageSince(from: Date | string, now = new Date()): string {
  const ms = now.getTime() - new Date(from).getTime();
  const h = Math.max(0, Math.floor(ms / 3_600_000));
  if (h < 1) return "under 1h";
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

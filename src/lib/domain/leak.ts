// The public "how much are you bleeding" calculator. Plain arithmetic on what the visitor types in; nothing is sent anywhere.

export interface LeakInput {
  /** People who bill time. */
  people: number;
  /** Average rate, rand per hour. */
  rate: number;
  /** Hours each of them works on client work in a week. */
  hoursPerWeek: number;
  /** Share of those hours that is never recorded or never invoiced, in percent. */
  unbilledPct: number;
  /** Hours a week of extra asks done without a change request. */
  creepHoursPerWeek: number;
  /** Hours a month delivered above what the retainers cover. */
  retainerOverHoursPerMonth: number;
}

export interface LeakResult {
  unbilled: number;
  creep: number;
  retainers: number;
  /** Rand a year slipping away. */
  total: number;
  /** A third of it: a deliberately modest recovery. */
  recoverable: number;
  /** Months of one person's cost the recoverable amount would pay for, at the same rate. */
  hoursRecoverable: number;
}

/** Billable working weeks a year after leave and public holidays. */
export const WORKING_WEEKS = 46;

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);

export function estimateLeak(input: LeakInput): LeakResult {
  const people = clamp(input.people, 0, 500);
  const rate = clamp(input.rate, 0, 20000);
  const hours = clamp(input.hoursPerWeek, 0, 60);
  const unbilledPct = clamp(input.unbilledPct, 0, 100);
  const creep = clamp(input.creepHoursPerWeek, 0, 500);
  const over = clamp(input.retainerOverHoursPerMonth, 0, 2000);
  const unbilled = Math.round(people * hours * (unbilledPct / 100) * rate * WORKING_WEEKS);
  const creepRand = Math.round(creep * rate * WORKING_WEEKS);
  const retainers = Math.round(over * rate * 12);
  const total = unbilled + creepRand + retainers;
  const recoverable = Math.round(total / 3);
  return { unbilled, creep: creepRand, retainers, total, recoverable, hoursRecoverable: rate ? Math.round(recoverable / rate) : 0 };
}

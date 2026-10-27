// Booking another person's time: the teams, and the rules a booking must pass.
// Pure, so the page can explain what's free and the server can enforce it.
import { isWeekday } from "./dates";

export const TEAMS = [
  { key: "design", label: "Design" },
  { key: "web", label: "Web" },
  { key: "content", label: "Content" },
  { key: "social", label: "Social" },
  { key: "account", label: "Account management" },
  { key: "strategy", label: "Strategy" },
  { key: "management", label: "Management" },
  { key: "finance", label: "Finance" },
] as const;
export type Team = (typeof TEAMS)[number]["key"];

/** Teams whose time anyone can book. */
export const BOOKABLE_TEAMS: Team[] = ["design", "web"];

export const DAY_START = "07:00";
export const DAY_END = "19:00";

export const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};
export const fromMinutes = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export const endTime = (start: string, hours: number) => fromMinutes(toMinutes(start) + Math.round(hours * 60));

export interface BookingRequest {
  date: string;
  start: string;
  hours: number;
}

export interface BookingLimits {
  today: string;
  /** The person's contracted hours per day. */
  dayCapacity: number;
  /** Their other bookings that day. */
  sameDay: { start: string; hours: number; title: string }[];
  /** Job budget hours not yet used or booked; null when the job has no hours budget. */
  jobHoursLeft: number | null;
  /** For hour-based scope items: hours left in scope; null for deliverable-based items. */
  scopeHoursLeft: number | null;
  scopeName: string;
  /** Strict (the default): the booking must fit the job's hours budget and a scope item. Loose: only time, job and the person's day. */
  strict?: boolean;
}

/** Every reason the booking can't go ahead, in plain words. Empty means it can. */
export function bookingProblems(r: BookingRequest, l: BookingLimits): string[] {
  const p: string[] = [];
  const h = (n: number) => `${Math.round(n * 100) / 100}h`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return ["Choose a date."];
  if (!/^\d{1,2}:\d{2}$/.test(r.start)) return ["Choose a start time."];
  if (!(r.hours > 0) || r.hours > 12) return ["Book between 15 minutes and 12 hours."];
  if (Math.round(r.hours * 4) !== r.hours * 4) p.push("Book in quarter hours (0.25, 0.5, 0.75…).");
  if (r.date < l.today) p.push("That date has passed.");
  if (!isWeekday(r.date)) p.push("That's a weekend. Book a weekday.");
  const start = toMinutes(r.start);
  const end = start + r.hours * 60;
  if (start < toMinutes(DAY_START) || end > toMinutes(DAY_END)) p.push(`Keep bookings between ${DAY_START} and ${DAY_END}.`);
  const clash = l.sameDay.find((b) => start < toMinutes(b.start) + b.hours * 60 && toMinutes(b.start) < end);
  if (clash) p.push(`Clashes with “${clash.title}” (${clash.start}–${endTime(clash.start, clash.hours)}).`);
  const free = l.dayCapacity - l.sameDay.reduce((s, b) => s + b.hours, 0);
  if (r.hours > free + 1e-9) p.push(free > 0 ? `Only ${h(free)} free that day.` : "Fully booked that day.");
  if (l.strict === false) return p;
  if (l.jobHoursLeft === null) p.push("This job has no hours budget. Set one on the job before booking time against it.");
  else if (r.hours > l.jobHoursLeft + 1e-9) p.push(l.jobHoursLeft > 0 ? `Only ${h(l.jobHoursLeft)} of the job's budget is left.` : "The job's hours budget is used up. Raise a change request in Scope Guard for more time.");
  if (l.scopeHoursLeft !== null && r.hours > l.scopeHoursLeft + 1e-9)
    p.push(l.scopeHoursLeft > 0 ? `Only ${h(l.scopeHoursLeft)} left in “${l.scopeName}”.` : `“${l.scopeName}” is used up. Raise a change request for more.`);
  return p;
}

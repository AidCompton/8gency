// Who is taking on too much: pure rules over a person's recent hours and
// booked work. Used by the Team › Workload view and the burnout-watch alert.

export type WorkloadStatus = "overloaded" | "stretched" | "balanced" | "light";

export interface WorkloadInput {
  /** Contracted hours per week. */
  weeklyHours: number;
  /** Hours logged in each of the last complete weeks, oldest first. */
  pastWeeks: number[];
  /** Hours logged so far this week. */
  thisWeek: number;
  /** Working days of this week elapsed so far (0–5). */
  thisWeekWorkdays: number;
  /** Weekend hours in the last 28 days. */
  weekendHours: number;
  /** Remaining estimated hours on open tasks due in the next 14 days. */
  bookedNext14: number;
  overdueTasks: number;
}

export interface WorkloadResult {
  status: WorkloadStatus;
  reasons: string[];
  /** Average of the last 4 complete weeks ÷ contracted hours. */
  recentLoad: number | null;
  /** Booked open work in the next 2 weeks ÷ 2 weeks of contracted hours. */
  bookedLoad: number | null;
  /** Complete weeks (of the last 4) more than 10% over contract. */
  overWeeks: number;
}

const h = (n: number) => `${Math.round(n)}h`;

export function assessWorkload(i: WorkloadInput): WorkloadResult {
  const w = i.weeklyHours;
  if (!(w > 0)) return { status: "balanced", reasons: [], recentLoad: null, bookedLoad: null, overWeeks: 0 };
  const last4 = i.pastWeeks.slice(-4);
  const avg = last4.length ? last4.reduce((s, x) => s + x, 0) / last4.length : 0;
  const recentLoad = last4.length ? avg / w : null;
  const overWeeks = last4.filter((x) => x > w * 1.1).length;
  const bookedLoad = i.bookedNext14 / (w * 2);
  // This week's pace against the contracted hours for the days gone so far.
  const paceBase = (w * Math.min(5, Math.max(1, i.thisWeekWorkdays))) / 5;
  const pace = i.thisWeek / paceBase;

  const reasons: string[] = [];
  const recentOver = last4.slice(-2).filter((x) => x > w * 1.1);
  if (recentOver.length) reasons.push(`Logged ${recentOver.map(h).join(" and ")} in ${recentOver.length === 1 ? "a recent week" : "the last two weeks"} (${h(w)} contracted)`);
  else if (recentLoad !== null && recentLoad > 1) reasons.push(`Averaging ${h(avg)} a week over the last 4 weeks (${h(w)} contracted)`);
  if (pace > 1.25 && i.thisWeek >= w * 0.4) reasons.push(`Already ${h(i.thisWeek)} this week`);
  if (bookedLoad > 1) reasons.push(`${h(i.bookedNext14)} of open work due in the next 2 weeks (${h(w * 2)} of capacity)`);
  if (i.weekendHours >= 4) reasons.push(`${h(i.weekendHours)} on weekends in the last 4 weeks`);
  if (i.overdueTasks >= 3) reasons.push(`${i.overdueTasks} overdue tasks`);

  let status: WorkloadStatus = "balanced";
  if (overWeeks >= 2 || (recentLoad ?? 0) > 1.15 || bookedLoad > 1.25 || (pace > 1.3 && i.thisWeek >= w * 0.5)) status = "overloaded";
  else if (overWeeks >= 1 || (recentLoad ?? 0) > 1 || bookedLoad > 1 || i.weekendHours >= 4 || i.overdueTasks >= 3 || pace > 1.25) status = "stretched";
  else if ((recentLoad ?? 0) < 0.5 && bookedLoad < 0.5 && i.thisWeek < paceBase * 0.5) {
    status = "light";
    reasons.push(`Averaging ${h(avg)} a week logged, with ${h(i.bookedNext14)} booked for the next 2 weeks`);
  }
  return { status, reasons, recentLoad, bookedLoad, overWeeks };
}

export const WORKLOAD_RANK: Record<WorkloadStatus, number> = { overloaded: 0, stretched: 1, balanced: 2, light: 3 };

// M14 retainer maths (SC-05, SC-08, FN-04).
import { daysBetween, type ISODate } from "./dates";

export interface BurnInput {
  allocatedHours: number;
  usedHours: number;
  startsOn: ISODate;
  endsOn: ISODate;
  today: ISODate;
  alertMargin: number; // e.g. 0.10 = alert when burn is 10 points ahead of time elapsed
}

export function retainerBurn(i: BurnInput) {
  const periodDays = daysBetween(i.startsOn, i.endsOn) + 1;
  const elapsedDays = Math.min(periodDays, Math.max(0, daysBetween(i.startsOn, i.today) + 1));
  const elapsed = periodDays > 0 ? elapsedDays / periodDays : 1;
  const burn = i.allocatedHours > 0 ? i.usedHours / i.allocatedHours : i.usedHours > 0 ? Infinity : 0;
  const projected = elapsed > 0 ? burn / elapsed : burn;
  const aheadBy = burn - elapsed;
  return {
    burn,
    elapsed,
    projected, // projected burn at period end at the current pace
    aheadBy,
    alert: aheadBy > i.alertMargin || burn > 1,
    remainingHours: Math.max(0, i.allocatedHours - i.usedHours),
    overHours: Math.max(0, i.usedHours - i.allocatedHours),
  };
}

export interface ReconcileInput {
  allocatedHours: number; // including rollover in
  usedHours: number;
  rollover: "none" | "capped";
  rolloverCapHours: number;
}

/** Month-end reconciliation: delivered against agreed, with rollover rules applied. */
export function reconcileRetainer(i: ReconcileInput) {
  const overageHours = Math.max(0, round2(i.usedHours - i.allocatedHours));
  const unusedHours = Math.max(0, round2(i.allocatedHours - i.usedHours));
  const rolloverOutHours = i.rollover === "capped" ? Math.min(unusedHours, i.rolloverCapHours) : 0;
  return { overageHours, unusedHours, rolloverOutHours, forfeitedHours: round2(unusedHours - rolloverOutHours) };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

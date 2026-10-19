// Part 3.4 core metrics. One definition for everyone (PF-08).

export function safeDiv(a: number, b: number): number | null {
  return b ? a / b : null;
}

/** Billable hours ÷ available hours. */
export function utilisation(billableHours: number, availableHours: number) {
  return safeDiv(billableHours, availableHours);
}

export function availableHours(weeklyHours: number, workingDays: number, leaveDays = 0) {
  return Math.max(0, (weeklyHours / 5) * (workingDays - leaveDays));
}

/** Value billed ÷ value of time worked at standard rates. */
export function realisation(billedCents: number, standardValueCents: number) {
  return safeDiv(billedCents, standardValueCents);
}

/** Revenue ÷ hours worked. Returns cents per hour. */
export function effectiveHourlyRate(revenueCents: number, hours: number) {
  const r = safeDiv(revenueCents, hours);
  return r === null ? null : Math.round(r);
}

/** (Revenue − direct labour cost − direct costs) ÷ revenue. */
export function projectMargin(revenueCents: number, labourCostCents: number, directCostCents: number) {
  return safeDiv(revenueCents - labourCostCents - directCostCents, revenueCents);
}

/** Hours or value delivered above scope ÷ scoped. */
export function overservicing(delivered: number, scoped: number) {
  return safeDiv(Math.max(0, delivered - scoped), scoped);
}

/** Debtors ÷ revenue × days in period. */
export function dso(debtorsCents: number, revenueCents: number, days: number) {
  const r = safeDiv(debtorsCents, revenueCents);
  return r === null ? null : Math.round(r * days);
}

export interface HealthInputs {
  onTimeRate: number | null; // 0..1
  overservicingRate: number | null; // 0..n
  avgDaysLate: number | null; // payment behaviour
  avgApprovalDays: number | null; // client response time
  satisfaction: number | null; // 1..5
}

/**
 * Client health score 0–100 (CL-05). Missing inputs are excluded and the
 * remaining weights are rescaled, so a new client isn't punished for no data.
 */
export function clientHealth(i: HealthInputs) {
  const parts: { key: string; weight: number; value: number | null }[] = [
    { key: "On-time delivery", weight: 30, value: i.onTimeRate === null ? null : clamp01(i.onTimeRate) },
    { key: "Scope discipline", weight: 20, value: i.overservicingRate === null ? null : clamp01(1 - i.overservicingRate / 0.3) },
    { key: "Payment behaviour", weight: 20, value: i.avgDaysLate === null ? null : clamp01(1 - i.avgDaysLate / 30) },
    { key: "Approval speed", weight: 15, value: i.avgApprovalDays === null ? null : clamp01(1 - (i.avgApprovalDays - 2) / 8) },
    { key: "Satisfaction", weight: 15, value: i.satisfaction === null ? null : clamp01((i.satisfaction - 1) / 4) },
  ];
  const known = parts.filter((p) => p.value !== null);
  const totalWeight = known.reduce((s, p) => s + p.weight, 0);
  if (!totalWeight) return { score: null as number | null, parts, band: "unknown" as const };
  const score = Math.round((known.reduce((s, p) => s + p.weight * (p.value as number), 0) / totalWeight) * 100);
  const band = score >= 75 ? ("healthy" as const) : score >= 55 ? ("watch" as const) : ("at_risk" as const);
  return { score, parts, band };
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

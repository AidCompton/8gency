// Default role permissions (blueprint 4.5). Field-level money restrictions are
// enforced by `can(user, "seeMargins")` / `"seeCostRates"` in every view, export and AI prompt.

export type Role = "owner" | "ops" | "finance" | "account" | "pm" | "staff";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner / MD",
  ops: "Operations",
  finance: "Finance",
  account: "Account manager",
  pm: "Project manager",
  staff: "Creative / staff",
};

export type Capability =
  | "seeAllJobs"
  | "seeMargins"
  | "seeCostRates"
  | "seeBudgetBurn"
  | "manageJobs"
  | "createChangeRequests"
  | "sendChangeRequests"
  | "approveInternal"
  | "billing"
  | "settings"
  | "manageTeam"
  | "seeTeamTime"
  | "audit"
  | "triage"
  | "automations";

const MATRIX: Record<Capability, Role[]> = {
  seeAllJobs: ["owner", "ops", "finance", "account", "pm"],
  seeMargins: ["owner", "ops", "finance", "account"],
  seeCostRates: ["owner", "ops", "finance"],
  seeBudgetBurn: ["owner", "ops", "finance", "account", "pm"],
  manageJobs: ["owner", "ops", "account", "pm"],
  createChangeRequests: ["owner", "ops", "account", "pm"],
  sendChangeRequests: ["owner", "ops", "account"],
  approveInternal: ["owner", "ops", "account", "pm"],
  billing: ["owner", "ops", "finance"],
  settings: ["owner", "ops"],
  manageTeam: ["owner", "ops"],
  // Ops and managers: everyone's time, by task, client and job, plus workload.
  seeTeamTime: ["owner", "ops", "account", "pm"],
  audit: ["owner", "ops", "finance"],
  triage: ["owner", "ops", "account", "pm"],
  // Everyone can build and run automations.
  automations: ["owner", "ops", "finance", "account", "pm", "staff"],
};

export interface PermissionSubject {
  role: Role;
  title?: string;
}

export function can(user: PermissionSubject, cap: Capability): boolean {
  if (cap === "approveInternal" && /creative director|\bcd\b/i.test(user.title ?? "")) return true;
  return MATRIX[cap].includes(user.role);
}

export class ForbiddenError extends Error {
  constructor(cap: Capability) {
    super(`You don't have permission to do that (${cap}).`);
  }
}

export function assertCan(user: PermissionSubject, cap: Capability) {
  if (!can(user, cap)) throw new ForbiddenError(cap);
}

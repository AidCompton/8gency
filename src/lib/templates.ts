// Agency-type templates (product principle 4: defaults over configuration).
// Rates are placeholders in ZAR cents per hour; every agency edits them in Settings.

export type AgencyType = "creative" | "digital" | "performance" | "social" | "pr" | "full_service" | "web_dev";

export const AGENCY_TYPES: { key: AgencyType; label: string }[] = [
  { key: "full_service", label: "Full-service" },
  { key: "creative", label: "Creative / design" },
  { key: "digital", label: "Digital" },
  { key: "performance", label: "Performance / media" },
  { key: "social", label: "Social and content" },
  { key: "pr", label: "PR and communications" },
  { key: "web_dev", label: "Web and development" },
];

export interface TaskTemplate {
  title: string;
  offsetDays: number; // due date offset from job start
  estimate: number; // hours
  scopeIndex?: number; // which scope item the task belongs to
}

export interface JobTemplate {
  key: string;
  name: string;
  jobType: string;
  billingModel: "fixed" | "tm" | "retainer" | "internal";
  durationDays: number;
  scope: { name: string; unit: "deliverable" | "hours"; quantity: number; rounds: number; inclusions?: string; exclusions?: string }[];
  tasks: TaskTemplate[];
  /** Fixed-fee billing schedule as fractions of the fee. */
  milestones?: { name: string; share: number; trigger: "start" | "completion" | "manual" }[];
}

const QA_TASK: TaskTemplate = { title: "QC checklist: spelling, logos, links, specs, legal lines", offsetDays: -1, estimate: 1 };

export const JOB_TEMPLATES: JobTemplate[] = [
  {
    key: "campaign",
    name: "Integrated campaign",
    jobType: "campaign",
    billingModel: "fixed",
    durationDays: 35,
    scope: [
      { name: "Campaign concept and key visual", unit: "deliverable", quantity: 1, rounds: 2, inclusions: "Two concept routes, one developed", exclusions: "Photography, media buying" },
      { name: "Social cut-downs (static)", unit: "deliverable", quantity: 6, rounds: 2, inclusions: "1:1 and 9:16 per asset" },
      { name: "Campaign video (30s)", unit: "deliverable", quantity: 1, rounds: 2, exclusions: "Talent and music licences" },
    ],
    tasks: [
      { title: "Strategy: insight and proposition", offsetDays: 5, estimate: 8, scopeIndex: 0 },
      { title: "Concept routes", offsetDays: 12, estimate: 16, scopeIndex: 0 },
      { title: "Develop chosen route", offsetDays: 18, estimate: 12, scopeIndex: 0 },
      { title: "Social statics", offsetDays: 26, estimate: 14, scopeIndex: 1 },
      { title: "Video script and edit", offsetDays: 30, estimate: 20, scopeIndex: 2 },
      QA_TASK,
    ],
    milestones: [
      { name: "Deposit (50%)", share: 0.5, trigger: "start" },
      { name: "On completion (50%)", share: 0.5, trigger: "completion" },
    ],
  },
  {
    key: "social_month",
    name: "Monthly social content",
    jobType: "social",
    billingModel: "retainer",
    durationDays: 28,
    scope: [
      { name: "Social posts", unit: "deliverable", quantity: 12, rounds: 1, inclusions: "Copy and static design", exclusions: "Paid media, community management" },
      { name: "Monthly report", unit: "deliverable", quantity: 1, rounds: 1 },
    ],
    tasks: [
      { title: "Content calendar for the month", offsetDays: 2, estimate: 4, scopeIndex: 0 },
      { title: "Copy for posts", offsetDays: 7, estimate: 6, scopeIndex: 0 },
      { title: "Design posts", offsetDays: 12, estimate: 12, scopeIndex: 0 },
      { title: "Schedule and publish", offsetDays: 14, estimate: 2, scopeIndex: 0 },
      { title: "Monthly performance report", offsetDays: 27, estimate: 3, scopeIndex: 1 },
    ],
  },
  {
    key: "website",
    name: "Website build",
    jobType: "web",
    billingModel: "fixed",
    durationDays: 60,
    scope: [
      { name: "Sitemap and wireframes", unit: "deliverable", quantity: 1, rounds: 2 },
      { name: "Page designs", unit: "deliverable", quantity: 6, rounds: 2, inclusions: "Desktop and mobile" },
      { name: "Build and CMS setup", unit: "hours", quantity: 80, rounds: 0, exclusions: "Copywriting, hosting fees" },
    ],
    tasks: [
      { title: "Discovery workshop", offsetDays: 3, estimate: 6, scopeIndex: 0 },
      { title: "Sitemap and wireframes", offsetDays: 12, estimate: 16, scopeIndex: 0 },
      { title: "Page designs", offsetDays: 28, estimate: 40, scopeIndex: 1 },
      { title: "Front-end build", offsetDays: 48, estimate: 50, scopeIndex: 2 },
      { title: "CMS setup and content load", offsetDays: 54, estimate: 20, scopeIndex: 2 },
      { title: "Go-live QA checklist", offsetDays: 58, estimate: 6, scopeIndex: 2 },
    ],
    milestones: [
      { name: "Deposit (40%)", share: 0.4, trigger: "start" },
      { name: "Designs approved (30%)", share: 0.3, trigger: "manual" },
      { name: "Go-live (30%)", share: 0.3, trigger: "completion" },
    ],
  },
  {
    key: "design",
    name: "Design job",
    jobType: "design",
    billingModel: "fixed",
    durationDays: 10,
    scope: [{ name: "Design deliverable", unit: "deliverable", quantity: 1, rounds: 2 }],
    tasks: [
      { title: "Design first version", offsetDays: 4, estimate: 6, scopeIndex: 0 },
      { title: "Amends", offsetDays: 8, estimate: 3, scopeIndex: 0 },
      QA_TASK,
    ],
    milestones: [{ name: "On completion", share: 1, trigger: "completion" }],
  },
  {
    key: "media_flight",
    name: "Paid media flight",
    jobType: "media",
    billingModel: "tm",
    durationDays: 30,
    scope: [
      { name: "Campaign setup and optimisation", unit: "hours", quantity: 24, rounds: 0, exclusions: "Media spend (billed as pass-through)" },
      { name: "Ad creative variants", unit: "deliverable", quantity: 8, rounds: 1 },
    ],
    tasks: [
      { title: "Media plan and naming/UTM setup", offsetDays: 3, estimate: 4, scopeIndex: 0 },
      { title: "Build campaigns", offsetDays: 6, estimate: 6, scopeIndex: 0 },
      { title: "Ad variants", offsetDays: 6, estimate: 8, scopeIndex: 1 },
      { title: "Weekly optimisation", offsetDays: 28, estimate: 8, scopeIndex: 0 },
      { title: "Flight wrap report", offsetDays: 30, estimate: 3, scopeIndex: 0 },
    ],
  },
  {
    key: "press_release",
    name: "Press release and outreach",
    jobType: "pr",
    billingModel: "fixed",
    durationDays: 14,
    scope: [
      { name: "Press release", unit: "deliverable", quantity: 1, rounds: 2 },
      { name: "Media outreach", unit: "hours", quantity: 10, rounds: 0 },
    ],
    tasks: [
      { title: "Draft release", offsetDays: 4, estimate: 4, scopeIndex: 0 },
      { title: "Media list", offsetDays: 6, estimate: 3, scopeIndex: 1 },
      { title: "Outreach and follow-up", offsetDays: 13, estimate: 7, scopeIndex: 1 },
    ],
    milestones: [{ name: "On completion", share: 1, trigger: "completion" }],
  },
  {
    key: "blank",
    name: "Blank job",
    jobType: "other",
    billingModel: "fixed",
    durationDays: 14,
    scope: [],
    tasks: [],
  },
];

export const TEMPLATES_BY_TYPE: Record<AgencyType, string[]> = {
  full_service: ["campaign", "social_month", "website", "design", "media_flight", "press_release", "blank"],
  creative: ["campaign", "design", "social_month", "blank"],
  digital: ["website", "media_flight", "social_month", "design", "blank"],
  performance: ["media_flight", "design", "blank"],
  social: ["social_month", "design", "campaign", "blank"],
  pr: ["press_release", "social_month", "blank"],
  web_dev: ["website", "design", "blank"],
};

export function jobTemplate(key: string | null | undefined): JobTemplate | undefined {
  return JOB_TEMPLATES.find((t) => t.key === key);
}

export const DEFAULT_RATE_CARD: { role: string; rate: number; cost: number }[] = [
  { role: "Creative Director", rate: 1650_00, cost: 720_00 },
  { role: "Strategist", rate: 1450_00, cost: 600_00 },
  { role: "Account Manager", rate: 1100_00, cost: 420_00 },
  { role: "Project Manager", rate: 950_00, cost: 380_00 },
  { role: "Senior Designer", rate: 1050_00, cost: 420_00 },
  { role: "Designer", rate: 850_00, cost: 300_00 },
  { role: "Copywriter", rate: 950_00, cost: 340_00 },
  { role: "Developer", rate: 1150_00, cost: 480_00 },
  { role: "Media Buyer", rate: 1000_00, cost: 380_00 },
  { role: "Social Media Manager", rate: 800_00, cost: 280_00 },
];

export const ONBOARDING_CHECKLIST: { label: string; category: string; clientFacing: boolean }[] = [
  { label: "Name approvers and commenters for each job type", category: "contacts", clientFacing: true },
  { label: "Billing contact, payment terms and PO rules captured", category: "billing", clientFacing: true },
  { label: "Vendor registration documents sent", category: "billing", clientFacing: false },
  { label: "Brand assets: logos, fonts, guidelines, tone of voice", category: "brand", clientFacing: true },
  { label: "Platform access: ad accounts, analytics, website, social", category: "access", clientFacing: true },
  { label: "Kick-off: response times, meeting rhythm, reporting dates, escalation path agreed", category: "kickoff", clientFacing: false },
  { label: "Signed MSA / SOW on file with scope baseline", category: "contract", clientFacing: false },
  { label: "Data processing details recorded (POPIA / GDPR) if we handle customer data", category: "compliance", clientFacing: true },
];

// The automation catalogue: every trigger, filter and action the builder offers
// and the engine runs, plus the template gallery and the built-in rules. Pure
// data, shared by the client builder and the server engine.

export type IconKey =
  | "briefcase" | "arrows" | "send" | "check" | "chat" | "inbox" | "receipt" | "coins" | "clock" | "hourglass" | "gauge"
  | "bell" | "envelope" | "whatsapp" | "tasks" | "slack" | "gmail" | "calendar" | "funnel" | "repeat" | "handshake" | "file";

export interface Field {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select";
  options?: { value: string; label: string }[];
  default: string | number;
  hint?: string;
  min?: number;
  max?: number;
}

export interface TriggerDef {
  type: string;
  kind: "event" | "schedule";
  group: "Jobs" | "Delivery" | "Clients" | "Money";
  label: string;
  description: string;
  icon: IconKey;
  fields: Field[];
}

export const JOB_STATUSES = [
  { value: "briefing", label: "Briefing" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting_client", label: "Waiting on client" },
  { value: "complete", label: "Complete" },
  { value: "closed", label: "Closed" },
];

export const TRIGGERS: TriggerDef[] = [
  { type: "job.created", kind: "event", group: "Jobs", label: "Job created", description: "A new job is opened for a client.", icon: "briefcase", fields: [] },
  {
    type: "job.status_changed", kind: "event", group: "Jobs", label: "Job status changes", description: "A job moves to a new status.", icon: "arrows",
    fields: [{ key: "to", label: "To status", type: "select", default: "any", options: [{ value: "any", label: "Any status" }, ...JOB_STATUSES] }],
  },
  { type: "deliverable.sent_to_client", kind: "event", group: "Delivery", label: "Sent for client approval", description: "A version goes to the client to review.", icon: "send", fields: [] },
  { type: "deliverable.approved", kind: "event", group: "Delivery", label: "Client approves work", description: "The client approves a deliverable.", icon: "check", fields: [] },
  { type: "deliverable.changes_requested", kind: "event", group: "Delivery", label: "Client asks for changes", description: "The client requests changes on a version.", icon: "chat", fields: [] },
  { type: "client_request.received", kind: "event", group: "Clients", label: "New client request", description: "A client asks for something (hub, email or WhatsApp).", icon: "inbox", fields: [] },
  { type: "change_request.approved", kind: "event", group: "Money", label: "Change request approved", description: "The client approves extra, priced work.", icon: "handshake", fields: [] },
  { type: "change_request.declined", kind: "event", group: "Money", label: "Change request declined", description: "The client declines a change request.", icon: "file", fields: [] },
  { type: "invoice.sent", kind: "event", group: "Money", label: "Invoice issued", description: "An invoice is issued to the client.", icon: "receipt", fields: [] },
  { type: "invoice.paid", kind: "event", group: "Money", label: "Invoice paid", description: "An invoice is paid in full.", icon: "coins", fields: [] },
  {
    type: "schedule.invoice_overdue", kind: "schedule", group: "Money", label: "Invoice overdue", description: "An issued invoice is unpaid this many days after its due date.", icon: "hourglass",
    fields: [{ key: "days", label: "Days past due", type: "number", default: 7, min: 1, max: 365 }],
  },
  {
    type: "schedule.deliverable_waiting", kind: "schedule", group: "Delivery", label: "Waiting on client approval", description: "A deliverable has been with the client this many days.", icon: "clock",
    fields: [{ key: "days", label: "Days waiting", type: "number", default: 3, min: 1, max: 90 }],
  },
  {
    type: "schedule.task_overdue", kind: "schedule", group: "Jobs", label: "Task overdue", description: "An open task is this many days past its due date.", icon: "hourglass",
    fields: [{ key: "days", label: "Days overdue", type: "number", default: 1, min: 0, max: 90 }],
  },
  {
    type: "schedule.budget_burn", kind: "schedule", group: "Jobs", label: "Job budget used", description: "A live job has used this share of its budgeted hours.", icon: "gauge",
    fields: [{ key: "percent", label: "Budget used (%)", type: "number", default: 80, min: 10, max: 300 }],
  },
];

export interface FilterDef {
  field: "company_id" | "billing_model" | "min_amount";
  label: string;
  input: "client" | "select" | "number";
  options?: { value: string; label: string }[];
}

export const FILTERS: FilterDef[] = [
  { field: "company_id", label: "Client is", input: "client" },
  {
    field: "billing_model", label: "Job billing model is", input: "select",
    options: [{ value: "fixed", label: "Fixed fee" }, { value: "tm", label: "Time and materials" }, { value: "retainer", label: "Retainer" }, { value: "internal", label: "Internal" }],
  },
  { field: "min_amount", label: "Amount is at least (R)", input: "number" },
];

const TEAM = [
  { value: "job_owner", label: "Job owner" },
  { value: "account_manager", label: "Account manager" },
  { value: "assignee", label: "Task assignee" },
  { value: "finance", label: "Finance team" },
  { value: "owner", label: "Agency owners" },
  { value: "ops", label: "Operations" },
];
const CONTACTS = [
  { value: "approver", label: "Approver" },
  { value: "billing", label: "Billing contact" },
  { value: "all", label: "All active contacts" },
];

export interface ActionDef {
  type: string;
  label: string;
  description: string;
  icon: IconKey;
  fields: Field[];
  /** Set for actions that need a connector that isn't live yet. */
  connector?: string;
}

export const ACTIONS: ActionDef[] = [
  {
    type: "notify", label: "Notify the team", description: "An in-app notification for the right people.", icon: "bell",
    fields: [
      { key: "to", label: "Who", type: "select", default: "job_owner", options: TEAM },
      { key: "message", label: "Message", type: "text", default: "{{trigger}}: {{item}}" },
    ],
  },
  {
    type: "email_client", label: "Email the client", description: "Queued in the Outbox and sent from your agency.", icon: "envelope",
    fields: [
      { key: "to", label: "To", type: "select", default: "approver", options: CONTACTS },
      { key: "subject", label: "Subject", type: "text", default: "{{item}}" },
      { key: "body", label: "Message", type: "textarea", default: "Hi {{contact}},\n\n…\n\n{{hub_link}}\n\n{{agency}}" },
    ],
  },
  {
    type: "whatsapp_client", label: "WhatsApp the client", description: "Sent to the contact's WhatsApp number.", icon: "whatsapp",
    fields: [
      { key: "to", label: "To", type: "select", default: "approver", options: CONTACTS },
      { key: "body", label: "Message", type: "textarea", default: "Hi {{contact}}, … {{hub_link}}" },
    ],
  },
  {
    type: "create_task", label: "Create a task", description: "Adds a task to the job, due in a few days.", icon: "tasks",
    fields: [
      { key: "title", label: "Task", type: "text", default: "Follow up: {{item}}" },
      { key: "assignee", label: "Assign to", type: "select", default: "job_owner", options: [{ value: "job_owner", label: "Job owner" }, { value: "account_manager", label: "Account manager" }, { value: "unassigned", label: "Nobody yet" }] },
      { key: "due_in_days", label: "Due in (days)", type: "number", default: 2, min: 0, max: 90 },
    ],
  },
  { type: "slack_message", label: "Post to Slack", description: "Post to a channel.", icon: "slack", fields: [], connector: "slack" },
  { type: "gmail_send", label: "Send from Gmail", description: "Send from your own mailbox.", icon: "gmail", fields: [], connector: "gmail" },
  { type: "calendar_event", label: "Add to Google Calendar", description: "Book time or a client meeting.", icon: "calendar", fields: [], connector: "google_calendar" },
];

/** Words you can drop into any message; filled from the record that triggered the run. */
export const VARIABLES = [
  { key: "client", label: "Client" },
  { key: "job", label: "Job" },
  { key: "item", label: "What happened to (deliverable, invoice…)" },
  { key: "amount", label: "Amount" },
  { key: "contact", label: "Contact's first name" },
  { key: "hub_link", label: "Client hub link" },
  { key: "days", label: "Days overdue / waiting" },
  { key: "percent", label: "Budget used (%)" },
  { key: "trigger", label: "Trigger name" },
  { key: "agency", label: "Your agency" },
];

export interface Step {
  type: string;
  config: Record<string, string | number>;
}
export interface Condition {
  field: FilterDef["field"];
  value: string;
}
export interface FlowDef {
  trigger: Step | null;
  filters: Condition[];
  actions: Step[];
}

export const triggerDef = (type?: string | null) => TRIGGERS.find((t) => t.type === type);
export const actionDef = (type?: string | null) => ACTIONS.find((a) => a.type === type);
export const defaults = (fields: Field[]) => Object.fromEntries(fields.map((f) => [f.key, f.default]));

export interface TemplateDef {
  key: string;
  name: string;
  description: string;
  category: "Clients" | "Delivery" | "Money" | "Team";
  flow: FlowDef;
}

const step = (type: string, config: Record<string, string | number> = {}): Step => {
  const def = triggerDef(type) ?? actionDef(type);
  return { type, config: { ...defaults(def?.fields ?? []), ...config } };
};

export const TEMPLATES: TemplateDef[] = [
  {
    key: "thank_on_payment", name: "Thank clients when they pay", category: "Money",
    description: "When an invoice is paid in full, email the billing contact a thank-you.",
    flow: {
      trigger: step("invoice.paid"), filters: [],
      actions: [step("email_client", { to: "billing", subject: "Payment received: {{item}}", body: "Hi {{contact}},\n\nThank you, we've received payment for {{item}} ({{amount}}).\n\n{{agency}}" })],
    },
  },
  {
    key: "kickoff_after_approval", name: "Wrap up approved work", category: "Delivery",
    description: "When the client approves a deliverable, create a final-files task for the job owner and tell the account manager.",
    flow: {
      trigger: step("deliverable.approved"), filters: [],
      actions: [step("create_task", { title: "Prepare and send final files: {{item}}", assignee: "job_owner", due_in_days: 2 }), step("notify", { to: "account_manager", message: "{{client}} approved {{item}}" })],
    },
  },
  {
    key: "changes_requested", name: "Act on client feedback", category: "Delivery",
    description: "When the client asks for changes, create a task so the feedback is picked up the same day.",
    flow: {
      trigger: step("deliverable.changes_requested"), filters: [],
      actions: [step("create_task", { title: "Address client feedback: {{item}}", assignee: "job_owner", due_in_days: 1 }), step("notify", { to: "job_owner", message: "Changes requested on {{item}}" })],
    },
  },
  {
    key: "new_request_alert", name: "Never miss a client request", category: "Clients",
    description: "When a client asks for something, tell their account manager straight away.",
    flow: { trigger: step("client_request.received"), filters: [], actions: [step("notify", { to: "account_manager", message: "New request from {{client}}: {{item}}" })] },
  },
  {
    key: "cr_to_finance", name: "Bill approved change requests", category: "Money",
    description: "When a change request is approved, tell finance so it's invoiced.",
    flow: { trigger: step("change_request.approved"), filters: [], actions: [step("notify", { to: "finance", message: "Approved change request to bill: {{item}} ({{amount}})" })] },
  },
  {
    key: "overdue_whatsapp", name: "WhatsApp nudge on overdue invoices", category: "Money",
    description: "A friendly WhatsApp to the billing contact a week after an invoice falls due.",
    flow: {
      trigger: step("schedule.invoice_overdue", { days: 7 }), filters: [],
      actions: [step("whatsapp_client", { to: "billing", body: "Hi {{contact}}, a quick reminder that invoice {{item}} ({{amount}}) is now {{days}} days overdue. You can view it here: {{hub_link}}. Thank you! {{agency}}" })],
    },
  },
  {
    key: "budget_heads_up", name: "Budget heads-up at 80%", category: "Team",
    description: "When a live job uses 80% of its hours, alert the job owner and account manager.",
    flow: {
      trigger: step("schedule.budget_burn", { percent: 80 }), filters: [],
      actions: [step("notify", { to: "job_owner", message: "{{job}} has used {{percent}}% of its budget" }), step("notify", { to: "account_manager", message: "{{job}} has used {{percent}}% of its budget" })],
    },
  },
  {
    key: "welcome_job", name: "Tell the client work has started", category: "Clients",
    description: "When a job moves to In progress, email the approver with their hub link.",
    flow: {
      trigger: step("job.status_changed", { to: "in_progress" }), filters: [],
      actions: [step("email_client", { to: "approver", subject: "We've started on {{job}}", body: "Hi {{contact}},\n\nGood news: work on {{job}} has started. You'll find progress, approvals and invoices in your hub: {{hub_link}}\n\n{{agency}}" })],
    },
  },
  {
    key: "feedback_on_complete", name: "Ask for feedback when a job is done", category: "Clients",
    description: "When a job is completed, email the approver a short feedback request.",
    flow: {
      trigger: step("job.status_changed", { to: "complete" }), filters: [],
      actions: [step("email_client", { to: "approver", subject: "How did we do on {{job}}?", body: "Hi {{contact}},\n\n{{job}} is complete. We'd love two minutes of feedback: what went well, and what could be better?\n\n{{agency}}" })],
    },
  },
  {
    key: "chase_approvals", name: "Chase slow approvals", category: "Delivery",
    description: "When a deliverable has waited 3 days for the client, email the approver.",
    flow: {
      trigger: step("schedule.deliverable_waiting", { days: 3 }), filters: [],
      actions: [step("email_client", { to: "approver", subject: "Waiting on you: {{item}}", body: "Hi {{contact}},\n\n“{{item}}” has been waiting for your review for {{days}} days. Approve or comment here: {{hub_link}}\n\n{{agency}}" })],
    },
  },
];

export interface BuiltinDef {
  key: string;
  name: string;
  description: string;
  trigger: { label: string; icon: IconKey; detail: string };
  actions: { label: string; icon: IconKey; detail: string }[];
}

/** The operating rules that ship with 8gency (implemented in code, can be switched off). */
export const BUILTINS: BuiltinDef[] = [
  { key: "budget_burn", name: "Budget burn alerts", description: "Alerts the job owner and account manager as a job passes 75%, 90% and 100% of its budget.", trigger: { label: "Job budget used", icon: "gauge", detail: "75% · 90% · 100%" }, actions: [{ label: "Notify the team", icon: "bell", detail: "Job owner, account manager" }] },
  { key: "task_late", name: "Overdue and blocked tasks", description: "Alerts the assignee and job owner when a task is overdue or blocked for more than a day.", trigger: { label: "Task overdue or blocked", icon: "hourglass", detail: "Daily" }, actions: [{ label: "Notify the team", icon: "bell", detail: "Assignee, job owner" }] },
  { key: "client_chase", name: "Chase client approvals", description: "Emails the approver once a day after a deliverable has waited two days.", trigger: { label: "Waiting on client approval", icon: "clock", detail: "After 2 days, daily" }, actions: [{ label: "Email the client", icon: "envelope", detail: "Approver, with review link" }] },
  { key: "stale_billing", name: "Unbilled milestones", description: "Tells finance when a completed milestone hasn't been invoiced within your limit.", trigger: { label: "Milestone not invoiced", icon: "receipt", detail: "Past your billing limit" }, actions: [{ label: "Notify the team", icon: "bell", detail: "Finance, owners" }] },
  { key: "client_checkins", name: "New client check-ins", description: "Reminds the account manager to check in at 30, 60 and 90 days.", trigger: { label: "Client anniversary", icon: "repeat", detail: "30 · 60 · 90 days" }, actions: [{ label: "Notify the team", icon: "bell", detail: "Account manager" }] },
  { key: "contract_renewals", name: "Contract renewals", description: "Reminds the account manager and owners 90, 60 and 30 days before a renewal or end date.", trigger: { label: "Contract renews or ends", icon: "file", detail: "90 · 60 · 30 days ahead" }, actions: [{ label: "Notify the team", icon: "bell", detail: "Account manager, owners" }] },
  { key: "retainer_alerts", name: "Retainer overservicing", description: "Alerts the account manager and owners when a retainer's hours run ahead of the month.", trigger: { label: "Retainer burn ahead", icon: "gauge", detail: "Mid-period" }, actions: [{ label: "Notify the team", icon: "bell", detail: "Account manager, owners" }] },
  { key: "collections", name: "Invoice reminders", description: "Polite reminders 3 days before due, then 1, 7 and 14 days after; escalates to the account manager at 14.", trigger: { label: "Invoice due or overdue", icon: "hourglass", detail: "−3 · 1 · 7 · 14 days" }, actions: [{ label: "Email the client", icon: "envelope", detail: "Billing contact" }, { label: "Notify the team", icon: "bell", detail: "Account manager at 14 days" }] },
];

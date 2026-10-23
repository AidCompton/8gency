// The connector roadmap: the apps agencies run on, what each will do inside
// 8gency, and when. Planning data only: nothing here connects yet.
// See docs/integrations-plan.md for the architecture and rollout.

export type ConnectorIcon =
  | "gmail" | "calendar" | "outlook" | "slack" | "whatsapp" | "teams" | "drive" | "dropbox" | "figma" | "canva"
  | "meta" | "google_ads" | "linkedin" | "analytics" | "tiktok" | "hubspot" | "mailchimp" | "klaviyo"
  | "xero" | "quickbooks" | "sage" | "payments" | "zoom" | "webhooks" | "zapier";

export interface ConnectorDef {
  key: string;
  name: string;
  category: "Email & calendar" | "Messaging" | "Files & creative" | "Ads & analytics" | "CRM & email marketing" | "Finance" | "Meetings" | "Developers";
  icon: ConnectorIcon;
  phase: 1 | 2 | 3;
  summary: string;
  does: string[];
}

export const CONNECTORS: ConnectorDef[] = [
  { key: "gmail", name: "Gmail", category: "Email & calendar", icon: "gmail", phase: 1, summary: "Send client emails from your own mailbox and file replies to the right job.", does: ["Outbox and automations send from your Gmail", "Client replies land on the job and in Scope Guard", "“Send from Gmail” step in automations"] },
  { key: "google_calendar", name: "Google Calendar", category: "Email & calendar", icon: "calendar", phase: 1, summary: "Meetings become time suggestions; deadlines and reviews go on calendars.", does: ["Client meetings pre-fill timesheets", "Job deadlines and review dates on team calendars", "“Add to Google Calendar” step in automations"] },
  { key: "outlook", name: "Microsoft 365 (Outlook)", category: "Email & calendar", icon: "outlook", phase: 1, summary: "The same email and calendar flows for agencies on Microsoft.", does: ["Send and receive client email from Outlook", "Calendar events feed timesheet suggestions", "Shared mailboxes for accounts@ and billing@"] },
  { key: "slack", name: "Slack", category: "Messaging", icon: "slack", phase: 1, summary: "Approvals, budget alerts and client requests where your team already talks.", does: ["Route notifications to a channel per client", "“Post to Slack” step in automations", "Log a client request from a Slack message"] },
  { key: "whatsapp", name: "WhatsApp Business", category: "Messaging", icon: "whatsapp", phase: 1, summary: "Deliver the WhatsApp messages 8gency already writes, and read replies.", does: ["Approvals by reply: APPROVE / CHANGES", "Invoice and approval reminders delivered", "Incoming requests go to Scope Guard"] },
  { key: "teams", name: "Microsoft Teams", category: "Messaging", icon: "teams", phase: 3, summary: "Notifications and automation steps for agencies on Teams.", does: ["Channel notifications per client", "“Post to Teams” automation step"] },
  { key: "google_drive", name: "Google Drive", category: "Files & creative", icon: "drive", phase: 2, summary: "Proof straight from Drive and file approved work back to the client folder.", does: ["Pick a Drive file as a new version", "Approved finals copied to the client folder", "Brief and contract docs linked to jobs"] },
  { key: "dropbox", name: "Dropbox", category: "Files & creative", icon: "dropbox", phase: 2, summary: "The same file flows for Dropbox studios.", does: ["Versions from Dropbox", "Finals filed back automatically"] },
  { key: "figma", name: "Figma", category: "Files & creative", icon: "figma", phase: 2, summary: "Send a Figma frame for client review without exporting.", does: ["Frames as proof versions", "Client comments synced to the file"] },
  { key: "canva", name: "Canva", category: "Files & creative", icon: "canva", phase: 3, summary: "Proof Canva designs for social and quick-turn work.", does: ["Designs as proof versions", "Approved designs exported to finals"] },
  { key: "meta_ads", name: "Meta Ads", category: "Ads & analytics", icon: "meta", phase: 2, summary: "Media spend against budget, per client, with re-billable costs captured.", does: ["Daily spend into job costs (re-billable)", "Spend vs budget alerts", "Results in the weekly status update"] },
  { key: "google_ads", name: "Google Ads", category: "Ads & analytics", icon: "google_ads", phase: 2, summary: "The same spend tracking and reporting for search and YouTube.", does: ["Spend into job costs", "Pacing alerts", "Campaign results in status reports"] },
  { key: "ga4", name: "Google Analytics 4", category: "Ads & analytics", icon: "analytics", phase: 2, summary: "Outcome numbers for status reports and retainer reviews.", does: ["Key results in weekly status updates", "Trends on the client page"] },
  { key: "linkedin_ads", name: "LinkedIn Ads", category: "Ads & analytics", icon: "linkedin", phase: 3, summary: "B2B campaign spend and results.", does: ["Spend into job costs", "Results in status reports"] },
  { key: "tiktok_ads", name: "TikTok Ads", category: "Ads & analytics", icon: "tiktok", phase: 3, summary: "Short-form campaign spend and results.", does: ["Spend into job costs", "Results in status reports"] },
  { key: "hubspot", name: "HubSpot", category: "CRM & email marketing", icon: "hubspot", phase: 2, summary: "Won deals become clients and jobs, with contacts kept in sync.", does: ["Closed-won deal → client + job from template", "Contacts synced both ways", "New-business time tracked against the deal"] },
  { key: "mailchimp", name: "Mailchimp", category: "CRM & email marketing", icon: "mailchimp", phase: 3, summary: "Campaign results for clients you run email for.", does: ["Campaign stats in status reports"] },
  { key: "klaviyo", name: "Klaviyo", category: "CRM & email marketing", icon: "klaviyo", phase: 3, summary: "E-commerce email results for retail clients.", does: ["Flow and campaign stats in status reports"] },
  { key: "xero", name: "Xero", category: "Finance", icon: "xero", phase: 1, summary: "Issued invoices post to Xero; payments come back automatically.", does: ["Invoices and credit notes pushed to Xero", "Payments reconcile the invoice in 8gency", "Contacts and tax rates kept in step"] },
  { key: "quickbooks", name: "QuickBooks", category: "Finance", icon: "quickbooks", phase: 2, summary: "The same invoice and payment sync for QuickBooks.", does: ["Invoices pushed", "Payments pulled back"] },
  { key: "sage", name: "Sage Business Cloud", category: "Finance", icon: "sage", phase: 3, summary: "Invoice and payment sync for Sage users in South Africa.", does: ["Invoices pushed", "Payments pulled back"] },
  { key: "payments", name: "PayFast · Paystack · Stripe", category: "Finance", icon: "payments", phase: 2, summary: "A pay-now button on every invoice in the client hub.", does: ["Card and instant EFT payments", "Paid invoices close themselves"] },
  { key: "zoom", name: "Zoom · Google Meet", category: "Meetings", icon: "zoom", phase: 2, summary: "Meeting time becomes billable time on the right job.", does: ["Meeting length suggested as time", "Recordings linked to the job"] },
  { key: "webhooks", name: "Webhooks", category: "Developers", icon: "webhooks", phase: 3, summary: "Send 8gency events to any URL; the automation engine's events, outward.", does: ["Signed event payloads", "“Send webhook” automation step"] },
  { key: "zapier", name: "Zapier · Make", category: "Developers", icon: "zapier", phase: 3, summary: "Everything else, through the tools agencies already script with.", does: ["8gency triggers and actions in Zapier and Make"] },
];

export const PHASES = {
  1: { label: "Phase 1", detail: "Email, calendar, messaging and accounting: the daily flow." },
  2: { label: "Phase 2", detail: "Files, ads spend, CRM and payments." },
  3: { label: "Phase 3", detail: "Long tail and developer tools." },
} as const;

// The walkthrough of the sample agency: one pop-up per stop, each pointing at a
// real part of the screen. {job} is replaced with the sample campaign's id.

export interface TourStep {
  path: string;
  /** CSS selector of what to point at; the pop-up centres itself if it isn't on the page. */
  target: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  { path: "/app", target: "#tour-attention", title: "Start here every morning", body: "Home lists what needs you, most urgent first: money owed, work over budget, clients going quiet. Each line takes you straight to the fix." },
  { path: "/app/pulse", target: "#tour-fixes", title: "Fix a leak in one click", body: "This is where the sample agency is losing money: work done but not invoiced, extra work nobody was charged for, an overdue invoice. Each one has a button that does the work and leaves a draft for you to check." },
  { path: "/app/jobs/{job}?tab=scope", target: "#tour-scope", title: "Every job starts with a scope", body: "What was sold, how many review rounds, what's excluded. Once it's approved, anything beyond it is flagged as extra work instead of quietly absorbed." },
  { path: "/app/time", target: "main h1", title: "Time goes on a job", body: "Everyone logs time against a job, by timer or by hand. Meetings from your calendar are suggested for you. Billable time flows to the client's next invoice, so nobody has to remember what was done." },
  { path: "/app/billing", target: "main h1", title: "Done work becomes an invoice", body: "Finished milestones, approved change requests and billable time collect here, ready to invoice. Invoices go out from your own email, and clients can approve work without a login." },
  { path: "/app/settings", target: "main h1", title: "Make it yours", body: "Switch off what you don't use, set your rates, invite your team. When you're ready, clear the sample data and bring in your own from Toggl, Trello or a spreadsheet." },
];

export const stepPath = (s: TourStep, jobId: string | null) => s.path.replace("{job}", jobId ?? "");

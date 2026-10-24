import Anthropic from "@anthropic-ai/sdk";
import type { Tx } from "../db";
import { addDays, daysBetween, formatShort, todayIn } from "../domain/dates";
import { clientResults } from "../connectors/ads";
import { formatMoney } from "../domain/money";
import { agencySettings } from "./core";
import { listRetainers } from "./retainers";

// 8gent rules (M25): a person approves anything client-facing before it is sent,
// every draft lists its sources, client data is never used for training, and
// the agency can switch AI off. Drafts never include cost rates or margins.

const MODEL = "claude-opus-5-5";

export interface Draft {
  text: string;
  sources: string[];
  generatedBy: "8gent-template" | "claude";
}

async function polishWithClaude(system: string, facts: string, fallback: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system,
      messages: [{ role: "user", content: `${facts}\n\nTemplate draft to improve:\n${fallback}` }],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch (e) {
    if (e instanceof Anthropic.APIError) console.error(`8gent: Claude API error ${e.status}: ${e.message}`);
    else console.error("8gent: Claude call failed", e);
    return null;
  }
}

/** Weekly client status update, drafted for the account manager to review (CL-02, workflow rhythm). */
export async function draftStatusReport(tx: Tx, companyId: string): Promise<Draft> {
  const settings = await agencySettings(tx);
  const today = todayIn(settings.timezone);
  const weekAgo = addDays(today, -7);
  const company = await tx.one<{ name: string }>("select name from companies where id = $1", [companyId]);
  const delivered = await tx.q<{ name: string; job_number: string; approved_at: Date }>(
    `select d.name, j.number as job_number, d.approved_at from deliverables d join jobs j on j.id = d.job_id
      where j.company_id = $1 and d.approved_at::date >= $2 order by d.approved_at`,
    [companyId, weekAgo],
  );
  const waiting = await tx.q<{ name: string; sent_to_client_at: Date }>(
    `select d.name, d.sent_to_client_at from deliverables d join jobs j on j.id = d.job_id
      where j.company_id = $1 and d.status = 'client_review' order by d.sent_to_client_at`,
    [companyId],
  );
  const crs = await tx.q<{ title: string; sent_at: Date }>("select title, sent_at from change_requests where company_id = $1 and status = 'sent'", [companyId]);
  const jobs = await tx.q<{ number: string; name: string; status: string; due_date: string | null; open: number; done: number }>(
    `select j.number, j.name, j.status, j.due_date,
            (select count(*)::int from tasks t where t.job_id = j.id and t.status <> 'done') as open,
            (select count(*)::int from tasks t where t.job_id = j.id and t.status = 'done') as done
       from jobs j where j.company_id = $1 and j.status in ('briefing','in_progress','waiting_client') order by j.due_date`,
    [companyId],
  );
  const upcoming = await tx.q<{ title: string; due_date: string; job_number: string }>(
    `select t.title, t.due_date, j.number as job_number from tasks t join jobs j on j.id = t.job_id
      where j.company_id = $1 and t.status <> 'done' and t.due_date between $2 and $3 order by t.due_date limit 8`,
    [companyId, today, addDays(today, 7)],
  );
  const retainers = (await listRetainers(tx, companyId)).filter((r) => r.period);

  const lines: string[] = [`Hi team,`, ``, `Here's where things stand this week for ${company?.name}.`, ``];
  lines.push(`Delivered this week`);
  lines.push(...(delivered.length ? delivered.map((d) => `• ${d.name} (${d.job_number}) — approved ${formatShort(d.approved_at.toISOString().slice(0, 10))}`) : ["• Nothing signed off this week."]));
  lines.push(``, `In progress`);
  lines.push(...(jobs.length ? jobs.map((j) => `• ${j.name} (${j.number}): ${j.done} of ${j.done + j.open} tasks done${j.due_date ? `, due ${formatShort(j.due_date)}` : ""}`) : ["• No live jobs."]));
  if (waiting.length || crs.length) {
    lines.push(``, `Waiting on you`);
    for (const w of waiting) lines.push(`• ${w.name} — with you for ${daysBetween(w.sent_to_client_at.toISOString().slice(0, 10), today)} day(s)`);
    for (const c of crs) lines.push(`• Change request to approve: ${c.title}`);
  }
  if (retainers.length) {
    lines.push(``, `Retainer`);
    for (const r of retainers) lines.push(`• ${r.retainer.name}: ${r.usedHours}h of ${r.allocated}h used this month`);
  }
  const results = await clientResults(tx, companyId, today);
  if (results.ads.length || results.web) {
    lines.push(``, `Results, last 7 days`);
    for (const a of results.ads) lines.push(`• ${a.platform}: ${formatMoney(a.spend, a.currency || "ZAR")} spent, ${a.clicks.toLocaleString("en-ZA")} clicks${a.conversions ? `, ${Math.round(a.conversions).toLocaleString("en-ZA")} conversions` : ""}`);
    if (results.web) {
      const w = results.web;
      const change = (now: number, before: number) => (before ? ` (${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)}%)` : "");
      lines.push(`• Website: ${w.users.toLocaleString("en-ZA")} visitors${change(w.users, w.prev.users)}, ${w.sessions.toLocaleString("en-ZA")} sessions${change(w.sessions, w.prev.sessions)}, ${w.key_events.toLocaleString("en-ZA")} key events${change(w.key_events, w.prev.key_events)}`);
    }
  }
  if (upcoming.length) {
    lines.push(``, `Coming up next week`);
    for (const u of upcoming) lines.push(`• ${u.title} (${u.job_number}) — ${formatShort(u.due_date)}`);
  }
  lines.push(``, `Any questions, just reply to this message.`, ``, `${settings.name}`);
  const template = lines.join("\n");
  const sources = [
    `${delivered.length} approvals in the last 7 days`,
    `${jobs.length} live jobs and their tasks`,
    `${waiting.length} items in client review, ${crs.length} change requests awaiting approval`,
    ...(retainers.length ? [`retainer burn for ${retainers.map((r) => r.retainer.name).join(", ")}`] : []),
    ...results.ads.map((a) => `${a.platform} spend synced from the connected ad account`),
    ...(results.web ? [`Google Analytics 4 (${results.web.property})`] : []),
  ];
  if (!settings.ai_enabled) return { text: template, sources, generatedBy: "8gent-template" };
  const polished = await polishWithClaude(
    "You draft weekly client status updates for a marketing agency's account manager, who will review and edit before sending. Keep every fact from the template exactly; do not invent work, dates or numbers. Warm, plain, concise. Plain text with short bullet lists, no markdown headings.",
    `Client: ${company?.name}\nToday: ${today}`,
    template,
  );
  return polished ? { text: polished, sources, generatedBy: "claude" } : { text: template, sources, generatedBy: "8gent-template" };
}

export interface WipRisk {
  job_id: string;
  number: string;
  name: string;
  company_name: string;
  reasons: string[];
  severity: number;
}

/**
 * Weekly WIP summary with deadline-risk prediction (M08, PM-01, PM-05).
 * Heuristic and explainable: remaining estimate vs. capacity before the due
 * date, budget burn ahead of progress, blocked tasks and client waits.
 */
export async function wipRisks(tx: Tx): Promise<WipRisk[]> {
  const settings = await agencySettings(tx);
  const today = todayIn(settings.timezone);
  const jobs = await tx.q<{
    id: string; number: string; name: string; company_name: string; due_date: string | null; budget_hours: number; hours: number;
    open: number; done: number; remaining_est: number; blocked: number; overdue: number; waiting_days: number | null; assignees: number;
  }>(
    `select j.id, j.number, j.name, c.name as company_name, j.due_date, j.budget_hours,
            coalesce((select sum(hours) from time_entries te where te.job_id = j.id),0) as hours,
            (select count(*)::int from tasks t where t.job_id = j.id and t.status <> 'done') as open,
            (select count(*)::int from tasks t where t.job_id = j.id and t.status = 'done') as done,
            coalesce((select sum(t.estimate_hours) from tasks t where t.job_id = j.id and t.status <> 'done'),0) as remaining_est,
            (select count(*)::int from tasks t where t.job_id = j.id and t.status = 'blocked') as blocked,
            (select count(*)::int from tasks t where t.job_id = j.id and t.status <> 'done' and t.due_date < $1) as overdue,
            (select max(extract(day from now() - d.sent_to_client_at)) from deliverables d where d.job_id = j.id and d.status = 'client_review') as waiting_days,
            (select count(distinct assignee_id)::int from tasks t where t.job_id = j.id and t.status <> 'done' and t.assignee_id is not null) as assignees
       from jobs j join companies c on c.id = j.company_id where j.status in ('in_progress','waiting_client','briefing')`,
    [today],
  );
  const risks: WipRisk[] = [];
  for (const j of jobs) {
    const reasons: string[] = [];
    let severity = 0;
    if (j.due_date) {
      const daysLeft = daysBetween(today, j.due_date);
      if (daysLeft < 0 && j.open > 0) {
        reasons.push(`past its due date by ${-daysLeft} day(s) with ${j.open} task(s) open`);
        severity += 3;
      } else if (j.open > 0) {
        const capacity = Math.max(1, j.assignees) * Math.max(0, daysLeft) * 6 * 0.7;
        if (j.remaining_est > capacity) {
          reasons.push(`${j.remaining_est}h of estimated work left with ~${Math.round(capacity)}h of capacity before ${formatShort(j.due_date)}`);
          severity += 2;
        }
      }
    }
    const progress = j.open + j.done ? j.done / (j.open + j.done) : 0;
    const burn = j.budget_hours ? j.hours / j.budget_hours : 0;
    if (burn > 1) {
      reasons.push(`over budget: ${Math.round(burn * 100)}% of hours used`);
      severity += 2;
    } else if (burn - progress > 0.25 && burn > 0.5) {
      reasons.push(`${Math.round(burn * 100)}% of budget used for ${Math.round(progress * 100)}% of tasks done`);
      severity += 1;
    }
    if (j.blocked) {
      reasons.push(`${j.blocked} blocked task(s)`);
      severity += 1;
    }
    if (j.overdue) {
      reasons.push(`${j.overdue} overdue task(s)`);
      severity += 1;
    }
    if ((j.waiting_days ?? 0) >= 3) {
      reasons.push(`waiting on client for ${j.waiting_days} days`);
      severity += 1;
    }
    if (reasons.length) risks.push({ job_id: j.id, number: j.number, name: j.name, company_name: j.company_name, reasons, severity });
  }
  return risks.sort((a, b) => b.severity - a.severity);
}

export async function draftWipSummary(tx: Tx): Promise<Draft> {
  const risks = await wipRisks(tx);
  const live = (await tx.one<{ n: number }>("select count(*)::int as n from jobs where status in ('briefing','in_progress','waiting_client')"))!.n;
  const lines = [`WIP summary: ${live} live jobs, ${risks.length} flagged.`, ``];
  for (const r of risks.slice(0, 12)) lines.push(`• ${r.number} ${r.name} (${r.company_name}): ${r.reasons.join("; ")}`);
  if (!risks.length) lines.push("Nothing flagged. All live jobs are on pace.");
  return { text: lines.join("\n"), sources: [`${live} live jobs: tasks, estimates, time, due dates and client reviews`], generatedBy: "8gent-template" };
}

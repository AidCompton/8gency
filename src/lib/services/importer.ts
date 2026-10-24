import type { Tx } from "../db";
import { createCompany } from "./agency";
import { rateFor } from "./core";
import { createJob } from "./jobs";

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

function pick(row: Record<string, string>, ...names: string[]): string {
  for (const n of names) if (row[n] !== undefined && row[n] !== "") return row[n];
  return "";
}

/** "1:30", "1:30:00", "1.5", "1,5" → hours. */
export function parseHours(v: string): number {
  if (!v) return 0;
  if (v.includes(":")) {
    const [h, m = "0", s = "0"] = v.split(":");
    return Number(h) + Number(m) / 60 + Number(s) / 3600;
  }
  return Number(v.replace(",", "."));
}

function parseDate(v: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // DD/MM/YYYY (ZA convention)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

export interface ImportSummary {
  rows: number;
  created: Record<string, number>;
  skipped: { row: number; reason: string }[];
}

async function companyByName(tx: Tx, name: string, summary: ImportSummary) {
  const found = await tx.one<{ id: string }>("select id from companies where lower(name) = lower($1)", [name]);
  if (found) return found.id;
  summary.created.clients = (summary.created.clients ?? 0) + 1;
  const id = await createCompany(tx, { name });
  await tx.q("update companies set status = 'active' where id = $1", [id]);
  return id;
}

async function jobByName(tx: Tx, companyId: string, name: string, billing: "tm" | "fixed", summary: ImportSummary) {
  const found = await tx.one<{ id: string }>("select id from jobs where company_id = $1 and lower(name) = lower($2)", [companyId, name]);
  if (found) return found.id;
  summary.created.jobs = (summary.created.jobs ?? 0) + 1;
  const id = await createJob(tx, { company_id: companyId, name, billing_model: billing, template_key: "blank", budget_hours: 0 });
  await tx.q("update jobs set status = 'in_progress', scope_locked_at = now() where id = $1", [id]);
  return id;
}

/** Clients CSV: name, code, billing email, po required, payment terms. */
export async function importClients(tx: Tx, rows: Record<string, string>[]): Promise<ImportSummary> {
  const s: ImportSummary = { rows: rows.length, created: {}, skipped: [] };
  for (const [i, r] of rows.entries()) {
    const name = pick(r, "name", "client", "company", "client name");
    if (!name) {
      s.skipped.push({ row: i + 2, reason: "No client name" });
      continue;
    }
    if (await tx.one("select 1 from companies where lower(name) = lower($1)", [name])) {
      s.skipped.push({ row: i + 2, reason: `${name} already exists` });
      continue;
    }
    await createCompany(tx, {
      name,
      code: pick(r, "code", "client code") || undefined,
      billing_email: pick(r, "billing email", "email"),
      po_required: /^(y|yes|true|1)$/i.test(pick(r, "po required", "po")),
      payment_terms_days: Number(pick(r, "payment terms", "terms")) || 30,
    });
    s.created.clients = (s.created.clients ?? 0) + 1;
  }
  return s;
}

/**
 * Time CSV in the shape Harvest and Toggl export: date, client, project, task,
 * hours (or duration), person email or name, billable, notes. Clients and jobs
 * are created when missing so history lands on jobs (Rule 1).
 */
export async function importTime(tx: Tx, rows: Record<string, string>[]): Promise<ImportSummary> {
  const s: ImportSummary = { rows: rows.length, created: {}, skipped: [] };
  const users = await tx.q<{ id: string; email: string; name: string; title: string; cost_rate_cents: number }>("select id, email, name, title, cost_rate_cents from users");
  for (const [i, r] of rows.entries()) {
    const date = parseDate(pick(r, "date", "start date", "spent date"));
    const hours = parseHours(pick(r, "hours", "duration", "time"));
    const client = pick(r, "client", "client name");
    const project = pick(r, "project", "project name", "job");
    const who = pick(r, "email", "user email", "person email", "user", "person", "first name");
    if (!date || !(hours > 0) || !client || !project) {
      s.skipped.push({ row: i + 2, reason: "Missing date, hours, client or project" });
      continue;
    }
    const user = users.find((u) => u.email.toLowerCase() === who.toLowerCase() || u.name.toLowerCase() === who.toLowerCase());
    if (!user) {
      s.skipped.push({ row: i + 2, reason: `No team member matches “${who}”. Add them in Settings → Team first.` });
      continue;
    }
    const billableRaw = pick(r, "billable", "billable?");
    const billable = billableRaw === "" || /^(y|yes|true|1)$/i.test(billableRaw);
    const companyId = await companyByName(tx, client, s);
    const jobId = await jobByName(tx, companyId, project, billable ? "tm" : "fixed", s);
    const taskTitle = pick(r, "task", "task name", "description");
    let taskId: string | null = null;
    if (taskTitle) {
      const t = await tx.one<{ id: string }>("select id from tasks where job_id = $1 and lower(title) = lower($2)", [jobId, taskTitle]);
      taskId =
        t?.id ??
        (await tx.one<{ id: string }>("insert into tasks (agency_id, job_id, title, assignee_id, status) values ($1,$2,$3,$4,'done') returning id", [tx.agencyId, jobId, taskTitle, user.id]))!.id;
    }
    const rate = await rateFor(tx, user.title, companyId, date);
    await tx.q(
      `insert into time_entries (agency_id, user_id, job_id, task_id, work_date, hours, category, notes, rate_cents, cost_cents, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'import')`,
      [tx.agencyId, user.id, jobId, taskId, date, Math.round(hours * 100) / 100, billable ? "billable" : "non_billable_client", pick(r, "notes", "description"), rate, user.cost_rate_cents],
    );
    s.created.time_entries = (s.created.time_entries ?? 0) + 1;
  }
  await tx.audit("import.time", "agency", tx.agencyId, undefined, s);
  return s;
}

/** Tasks CSV in the shape Asana, Monday, ClickUp and Trello export: name, project, client, assignee email, due date, status. */
export async function importTasks(tx: Tx, rows: Record<string, string>[]): Promise<ImportSummary> {
  const s: ImportSummary = { rows: rows.length, created: {}, skipped: [] };
  const users = await tx.q<{ id: string; email: string; name: string }>("select id, email, name from users");
  for (const [i, r] of rows.entries()) {
    const title = pick(r, "name", "task", "task name", "item", "card name");
    const project = pick(r, "project", "projects", "board", "list", "group");
    const client = pick(r, "client", "client name") || project;
    if (!title || !project) {
      s.skipped.push({ row: i + 2, reason: "Missing task name or project" });
      continue;
    }
    const companyId = await companyByName(tx, client, s);
    const jobId = await jobByName(tx, companyId, project, "fixed", s);
    const who = pick(r, "assignee email", "assignee", "owner", "person");
    const user = users.find((u) => u.email.toLowerCase() === who.toLowerCase() || u.name.toLowerCase() === who.toLowerCase());
    const done = /^(done|complete|completed|true|yes)$/i.test(pick(r, "status", "completed", "completed at") ? (pick(r, "completed at") ? "done" : pick(r, "status", "completed")) : "");
    await tx.q("insert into tasks (agency_id, job_id, title, assignee_id, due_date, status) values ($1,$2,$3,$4,$5,$6)", [
      tx.agencyId,
      jobId,
      title,
      user?.id ?? null,
      parseDate(pick(r, "due date", "due", "date")),
      done ? "done" : "todo",
    ]);
    s.created.tasks = (s.created.tasks ?? 0) + 1;
  }
  return s;
}

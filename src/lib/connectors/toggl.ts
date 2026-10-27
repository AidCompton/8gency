import type { Tx } from "../db";
import { addDays, todayIn } from "../domain/dates";
import { entryHours, localDate } from "../domain/imports";
import { agencySettings, rateFor } from "../services/core";
import { ConnectorError, readSecret, updateSettings, upsertObject, type Conn } from "./connections";
import { clientNamed, jobAwaitingScope, mapExternal } from "./pull";

// Toggl Track, read-only. Every sync reads clients, projects, people and the last
// 14 days of time (90 days the first time), keeps them as pulled records, and
// turns time on projects the owner has mapped to a job into time entries.
// Untried against a real Toggl workspace: shapes follow Toggl's v9 and Reports v3 docs.

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = "https://api.track.toggl.com";
const FIRST_DAYS = 90;
const WINDOW_DAYS = 14;
const MAX_PAGES = 30;

async function call(token: string, path: string, init: RequestInit = {}): Promise<{ data: any; res: Response }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Basic ${Buffer.from(`${token}:api_token`).toString("base64")}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  if (res.status === 401 || res.status === 403) throw new ConnectorError("Toggl turned down that API token. Paste a fresh one on the Toggl connector page.");
  if (res.status === 429) throw new ConnectorError("Toggl is limiting how often we can ask. It will try again at the next sync.");
  if (!res.ok) throw new ConnectorError(`Toggl said ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const text = await res.text();
  return { data: text ? JSON.parse(text) : null, res };
}

/** For the connect form: does this token work, and whose is it? */
export async function checkTogglToken(token: string) {
  const { data } = await call(token, "/api/v9/me");
  return { label: `${data.fullname ?? data.email} (Toggl)`, email: data.email as string, workspaceId: String(data.default_workspace_id ?? "") };
}

export interface TogglProject {
  id: string;
  name: string;
  client: string;
  active: boolean;
  billable: boolean;
}

export async function syncToggl(tx: Tx, conn: Conn) {
  const secret = await readSecret(tx, conn.id);
  const token = String(secret.api_token ?? "");
  const settings = await agencySettings(tx);
  const me = (await call(token, "/api/v9/me")).data;
  const wid = String(conn.settings.workspace_id || secret.workspace_id || me.default_workspace_id || "");
  if (!wid) throw new ConnectorError("Toggl didn't say which workspace to read. Add the workspace ID on the connector page.");
  if (conn.settings.workspace_id !== wid) await updateSettings(tx, conn.id, { workspace_id: wid });

  const clients = new Map<number, string>(((await call(token, `/api/v9/workspaces/${wid}/clients`)).data ?? []).map((c: any) => [c.id, String(c.name)]));

  // Projects (paged).
  const projects: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch: any[] = (await call(token, `/api/v9/workspaces/${wid}/projects?active=both&per_page=200&page=${page}`)).data ?? [];
    projects.push(...batch);
    if (batch.length < 200) break;
  }
  for (const p of projects) {
    await upsertObject(tx, conn, {
      kind: "toggl_project",
      externalId: String(p.id),
      payload: { name: String(p.name), client: p.client_id ? clients.get(p.client_id) ?? "" : "", active: p.active !== false, billable: p.billable !== false },
    });
  }

  // People, matched to the team by email.
  const team = await tx.q<{ id: string; email: string }>("select id, email from users where active");
  const workspaceUsers: any[] = (await call(token, `/api/v9/workspaces/${wid}/workspace_users`)).data ?? [];
  for (const u of workspaceUsers) {
    const togglId = String(u.uid ?? u.user_id ?? u.id);
    const existing = await tx.one<{ matched_id: string | null }>("select matched_id from external_objects where connection_id = $1 and kind = 'toggl_user' and external_id = $2", [conn.id, togglId]);
    const byEmail = team.find((t) => t.email.toLowerCase() === String(u.email ?? "").toLowerCase())?.id ?? null;
    await upsertObject(tx, conn, { kind: "toggl_user", externalId: togglId, payload: { name: String(u.name ?? u.email ?? ""), email: String(u.email ?? "") }, matchedType: "user", matchedId: existing?.matched_id ?? byEmail });
  }

  // Time: Reports API, everyone's entries in the window.
  const today = todayIn(settings.timezone);
  const from = addDays(today, -(conn.cursor ? WINDOW_DAYS : FIRST_DAYS));
  const runStart = (await tx.one<{ now: Date }>("select now() as now"))!.now;
  let rows = 0;
  let next: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, res } = await call(token, `/reports/api/v3/workspace/${wid}/search/time_entries`, {
      method: "POST",
      body: JSON.stringify({ start_date: from, end_date: today, page_size: 1000, ...(next ? { first_row_number: Number(next) } : {}) }),
    });
    for (const row of (data ?? []) as any[]) {
      for (const e of row.time_entries ?? []) {
        const hours = entryHours(Number(e.seconds));
        if (!hours || !e.start) continue;
        rows++;
        await upsertObject(tx, conn, {
          kind: "toggl_entry",
          externalId: String(e.id),
          on: localDate(e.start, settings.timezone),
          payload: { project_id: row.project_id ? String(row.project_id) : "", toggl_user: String(row.user_id), hours, description: String(row.description ?? ""), billable: row.billable !== false },
        });
      }
    }
    next = res.headers.get("x-next-row-number");
    if (!next) break;
  }

  // Entries inside the window that Toggl no longer returns were deleted there: remove ours too, unless billed or locked.
  const gone = await tx.q<{ id: string; matched_id: string | null }>(
    "select id, matched_id from external_objects where connection_id = $1 and kind = 'toggl_entry' and occurred_on >= $2 and updated_at < $3",
    [conn.id, from, runStart],
  );
  for (const g of gone) {
    if (g.matched_id) await tx.q("delete from time_entries where id = $1 and invoice_line_id is null and not locked", [g.matched_id]);
    await tx.q("delete from external_objects where id = $1", [g.id]);
  }

  const applied = await applyToggl(tx, conn);
  await tx.q("update connections set cursor = $2 where id = $1", [conn.id, today]);
  const pending = await togglStatus(tx, conn);
  return `${projects.length} projects, ${rows} time entries read; ${applied.created} new and ${applied.updated} changed entries added to jobs${pending.unmappedProjects ? `; ${pending.unmappedProjects} projects still to map` : ""}${pending.unmatchedPeople ? `; ${pending.unmatchedPeople} people to match` : ""}`;
}

/** Turn pulled entries on mapped projects and matched people into time entries. Safe to run any time. */
export async function applyToggl(tx: Tx, conn: Pick<Conn, "id">) {
  const out = { created: 0, updated: 0 };
  const maps = await tx.q<{ external_id: string; job_id: string | null; company_id: string | null }>("select external_id, job_id, company_id from connection_mappings where connection_id = $1 and job_id is not null and external_id not like 'user:%'", [conn.id]);
  const people = new Map((await tx.q<{ external_id: string; matched_id: string | null }>("select external_id, matched_id from external_objects where connection_id = $1 and kind = 'toggl_user' and matched_id is not null", [conn.id])).map((p) => [p.external_id, p.matched_id!]));
  const users = new Map((await tx.q<{ id: string; title: string; cost_rate_cents: number }>("select id, title, cost_rate_cents from users")).map((u) => [u.id, u]));
  for (const m of maps) {
    const entries = await tx.q<{ id: string; external_id: string; occurred_on: string; matched_id: string | null; payload: { toggl_user: string; hours: number; description: string; billable: boolean } }>(
      "select id, external_id, occurred_on::text, matched_id, payload from external_objects where connection_id = $1 and kind = 'toggl_entry' and payload->>'project_id' = $2",
      [conn.id, m.external_id],
    );
    for (const e of entries) {
      const userId = people.get(e.payload.toggl_user);
      const user = userId ? users.get(userId) : undefined;
      if (!userId || !user) continue;
      if (e.matched_id) {
        const r = await tx.q("update time_entries set hours = $2, notes = $3, category = $4 where id = $1 and (hours <> $2 or notes <> $3) and invoice_line_id is null and not locked returning 1", [e.matched_id, e.payload.hours, e.payload.description, e.payload.billable ? "billable" : "non_billable_client"]);
        out.updated += r.length;
        continue;
      }
      const rate = await rateFor(tx, user.title, m.company_id, e.occurred_on);
      const row = await tx.one<{ id: string }>(
        `insert into time_entries (agency_id, user_id, job_id, work_date, hours, category, notes, rate_cents, cost_cents, source)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'import') returning id`,
        [tx.agencyId, userId, m.job_id, e.occurred_on, e.payload.hours, e.payload.billable ? "billable" : "non_billable_client", e.payload.description, rate, user.cost_rate_cents],
      );
      await tx.q("update external_objects set matched_type = 'time_entry', matched_id = $2 where id = $1", [e.id, row!.id]);
      out.created++;
    }
  }
  return out;
}

export async function togglStatus(tx: Tx, conn: Pick<Conn, "id">) {
  const one = async (sql: string) => Number((await tx.one<{ n: number }>(sql, [conn.id]))!.n);
  return {
    projects: await one("select count(*)::int as n from external_objects where connection_id = $1 and kind = 'toggl_project'"),
    entries: await one("select count(*)::int as n from external_objects where connection_id = $1 and kind = 'toggl_entry'"),
    applied: await one("select count(*)::int as n from external_objects where connection_id = $1 and kind = 'toggl_entry' and matched_id is not null"),
    unmappedProjects: await one(
      "select count(*)::int as n from external_objects o where o.connection_id = $1 and o.kind = 'toggl_project' and (o.payload->>'active')::boolean and not exists (select 1 from connection_mappings m where m.connection_id = o.connection_id and m.external_id = o.external_id and m.job_id is not null)",
    ),
    unmatchedPeople: await one("select count(*)::int as n from external_objects where connection_id = $1 and kind = 'toggl_user' and matched_id is null"),
  };
}

export async function togglPanel(tx: Tx, conn: Pick<Conn, "id">) {
  const projects = await tx.q<{ external_id: string; name: string; client: string; active: boolean; hours: number; job_id: string | null; job_label: string | null }>(
    `select o.external_id, o.payload->>'name' as name, o.payload->>'client' as client, (o.payload->>'active')::boolean as active,
            coalesce((select sum((e.payload->>'hours')::numeric) from external_objects e where e.connection_id = o.connection_id and e.kind = 'toggl_entry' and e.payload->>'project_id' = o.external_id), 0)::float as hours,
            m.job_id, j.number || ' ' || j.name as job_label
       from external_objects o
       left join connection_mappings m on m.connection_id = o.connection_id and m.external_id = o.external_id
       left join jobs j on j.id = m.job_id
      where o.connection_id = $1 and o.kind = 'toggl_project'
      order by (m.job_id is null) desc, o.payload->>'client', o.payload->>'name'`,
    [conn.id],
  );
  const people = await tx.q<{ external_id: string; name: string; email: string; matched_id: string | null }>(
    "select external_id, payload->>'name' as name, payload->>'email' as email, matched_id from external_objects where connection_id = $1 and kind = 'toggl_user' order by (matched_id is null) desc, payload->>'name'",
    [conn.id],
  );
  return { projects, people, status: await togglStatus(tx, conn) };
}

/** Create the client (if needed) and a job awaiting scope for a Toggl project, and map it. */
export async function mapTogglProject(tx: Tx, conn: Conn, projectId: string, target: { companyId?: string; newClientName?: string }) {
  const p = await tx.one<{ payload: { name: string; client: string; billable: boolean } }>("select payload from external_objects where connection_id = $1 and kind = 'toggl_project' and external_id = $2", [conn.id, projectId]);
  if (!p) throw new ConnectorError("That Toggl project is no longer in the last sync. Sync again.");
  const companyId = target.companyId || (await clientNamed(tx, target.newClientName || p.payload.client));
  const jobId = await jobAwaitingScope(tx, companyId, p.payload.name, p.payload.billable);
  await mapExternal(tx, conn, projectId, `${p.payload.client ? `${p.payload.client} · ` : ""}${p.payload.name}`, { companyId, jobId });
  await tx.audit("connector.mapped", "connection", conn.id, undefined, { provider: "toggl", project: p.payload.name, job_id: jobId });
  return jobId;
}

export async function matchTogglPerson(tx: Tx, conn: Pick<Conn, "id">, togglUserId: string, userId: string) {
  await tx.q("update external_objects set matched_type = 'user', matched_id = $3 where connection_id = $1 and kind = 'toggl_user' and external_id = $2", [conn.id, togglUserId, userId || null]);
}

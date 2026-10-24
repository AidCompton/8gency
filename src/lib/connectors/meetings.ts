import type { Tx } from "../db";
import { agencySettings } from "../services/core";
import { api, upsertObject, type Conn } from "./connections";

// Meetings from people's calendars and Zoom, matched to a client's job, so
// they turn up as timesheet suggestions ("45-min meeting with Vela Health").

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Meeting {
  id: string;
  title: string;
  start: string;
  minutes: number;
  attendees: string[];
  source: string;
}

const PUBLIC_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com"]);

/**
 * Best guess at the job a meeting was for: a job number in the title, else the
 * client from the attendees' email addresses (or the client's name in the
 * title), then that client's job named in the title or its most active one.
 */
export async function matchJob(tx: Tx, title: string, emails: string[]): Promise<string | null> {
  const byNumber = await tx.one<{ id: string }>("select id from jobs where status <> 'closed' and length(number) > 3 and position(lower(number) in lower($1)) > 0 limit 1", [title]);
  if (byNumber) return byNumber.id;
  const lower = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  const own = new Set((await tx.q<{ d: string }>("select distinct split_part(lower(email), '@', 2) as d from users")).map((r) => r.d));
  const domains = [...new Set(lower.map((e) => e.split("@")[1]).filter((d) => d && !PUBLIC_MAIL.has(d) && !own.has(d)))];
  const company =
    (await tx.one<{ id: string }>("select company_id as id from contacts where lower(email) = any($1) and active limit 1", [lower])) ??
    (domains.length ? await tx.one<{ id: string }>("select company_id as id from contacts where split_part(lower(email), '@', 2) = any($1) group by 1 order by count(*) desc limit 1", [domains]) : null) ??
    (await tx.one<{ id: string }>("select id from companies where kind = 'client' and length(name) >= 3 and position(lower(name) in lower($1)) > 0 order by length(name) desc limit 1", [title]));
  if (!company) return null;
  const job = await tx.one<{ id: string }>(
    `select j.id from jobs j
      where j.company_id = $1 and j.status in ('briefing','in_progress','waiting_client')
      order by (length(j.name) >= 4 and position(lower(j.name) in lower($2)) > 0) desc,
               greatest(j.created_at, (select max(te.created_at) from time_entries te where te.job_id = j.id)) desc nulls last
      limit 1`,
    [company.id, title],
  );
  return job?.id ?? null;
}

const localDate = (iso: string, tz: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });

async function store(tx: Tx, conn: Conn, meetings: Meeting[]) {
  const { timezone } = await agencySettings(tx);
  let matched = 0;
  for (const m of meetings) {
    if (m.minutes < 10 || m.minutes > 8 * 60) continue;
    const existing = await tx.one<{ matched_id: string | null }>("select matched_id from external_objects where connection_id = $1 and kind = 'meeting' and external_id = $2", [conn.id, m.id]);
    const job = existing ? existing.matched_id : await matchJob(tx, m.title, m.attendees);
    await upsertObject(tx, conn, { kind: "meeting", externalId: m.id, on: localDate(m.start, timezone), payload: m, matchedType: job ? "job" : null, matchedId: job });
    if (job) matched++;
  }
  return `${meetings.length} meetings, ${matched} matched to jobs`;
}

const since = () => new Date(Date.now() - 14 * 86400_000).toISOString();

export async function syncGoogleCalendar(tx: Tx, conn: Conn) {
  const out: Meeting[] = [];
  let page = "";
  for (let i = 0; i < 5; i++) {
    const q = new URLSearchParams({ timeMin: since(), timeMax: new Date().toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250", ...(page ? { pageToken: page } : {}) });
    const r = await api(tx, conn, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`);
    for (const e of r.items ?? []) {
      const me = (e.attendees ?? []).find((a: any) => a.self);
      if (e.status === "cancelled" || !e.start?.dateTime || me?.responseStatus === "declined") continue;
      out.push({
        id: e.id,
        title: e.summary ?? "",
        start: e.start.dateTime,
        minutes: Math.round((Date.parse(e.end.dateTime) - Date.parse(e.start.dateTime)) / 60_000),
        attendees: (e.attendees ?? []).filter((a: any) => !a.self).map((a: any) => a.email),
        source: e.hangoutLink ? "Google Meet" : "Google Calendar",
      });
    }
    page = r.nextPageToken;
    if (!page) break;
  }
  return store(tx, conn, out);
}

export async function syncOutlookCalendar(tx: Tx, conn: Conn) {
  const q = new URLSearchParams({ startDateTime: since(), endDateTime: new Date().toISOString(), $top: "250", $select: "id,subject,start,end,attendees,isCancelled,isAllDay,responseStatus,isOnlineMeeting" });
  const r = await api(tx, conn, `https://graph.microsoft.com/v1.0/me/calendarView?${q}`, { headers: { prefer: 'outlook.timezone="UTC"' } });
  const out: Meeting[] = (r.value ?? [])
    .filter((e: any) => !e.isCancelled && !e.isAllDay && e.responseStatus?.response !== "declined")
    .map((e: any) => ({
      id: e.id,
      title: e.subject ?? "",
      start: `${e.start.dateTime.replace(/Z?$/, "")}Z`,
      minutes: Math.round((Date.parse(`${e.end.dateTime.replace(/Z?$/, "")}Z`) - Date.parse(`${e.start.dateTime.replace(/Z?$/, "")}Z`)) / 60_000),
      attendees: (e.attendees ?? []).map((a: any) => a.emailAddress?.address).filter(Boolean),
      source: e.isOnlineMeeting ? "Teams" : "Outlook",
    }));
  return store(tx, conn, out);
}

export async function syncZoom(tx: Tx, conn: Conn) {
  const r = await api(tx, conn, "https://api.zoom.us/v2/users/me/meetings?type=previous_meetings&page_size=100");
  const cutoff = Date.parse(since());
  // ponytail: scheduled length, not actual; read /past_meetings/{uuid} if people over- or under-run a lot.
  const out: Meeting[] = (r.meetings ?? [])
    .filter((m: any) => m.start_time && Date.parse(m.start_time) >= cutoff && Date.parse(m.start_time) <= Date.now())
    .map((m: any) => ({ id: m.uuid ?? String(m.id), title: m.topic ?? "", start: m.start_time, minutes: Number(m.duration) || 0, attendees: [], source: "Zoom" }));
  return store(tx, conn, out);
}

/** Matched meetings for one person on one day that aren't logged yet: fed into timesheet suggestions. */
export async function meetingsFor(tx: Tx, userId: string, date: string) {
  return tx.q<{ job_id: string; title: string; minutes: number; source: string }>(
    `select o.matched_id as job_id, o.payload->>'title' as title, (o.payload->>'minutes')::int as minutes, o.payload->>'source' as source
       from external_objects o join connections c on c.id = o.connection_id and c.user_id = $1
       join jobs j on j.id = o.matched_id and j.status <> 'closed'
      where o.kind = 'meeting' and o.matched_type = 'job' and o.occurred_on = $2
      order by o.payload->>'start'`,
    [userId, date],
  );
}

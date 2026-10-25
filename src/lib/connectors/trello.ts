import type { Tx } from "../db";
import { cardStatus } from "../domain/imports";
import { ConnectorError, readSecret, upsertObject, type Conn } from "./connections";
import { clientNamed, jobAwaitingScope, mapExternal } from "./pull";

// Trello, read-only. Boards the owner maps become jobs awaiting scope; their open
// cards become tasks (due date, owner, and a status from the list they sit in).
// Credentials go in a header, never in the address. Untried against a real Trello account.

/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(key: string, token: string, path: string): Promise<any> {
  const res = await fetch(`https://api.trello.com/1${path}`, { headers: { authorization: `OAuth oauth_consumer_key="${key}", oauth_token="${token}"`, accept: "application/json" } });
  if (res.status === 401 || res.status === 403) throw new ConnectorError("Trello turned down that key and token. Create a new token on the Trello connector page.");
  if (res.status === 429) throw new ConnectorError("Trello is limiting how often we can ask. It will try again at the next sync.");
  if (!res.ok) throw new ConnectorError(`Trello said ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res.json();
}

export async function checkTrello(key: string, token: string) {
  const me = await call(key, token, "/members/me?fields=fullName,username");
  return `${me.fullName ?? me.username} (Trello)`;
}

const creds = async (tx: Tx, conn: Pick<Conn, "id">) => {
  const s = await readSecret(tx, conn.id);
  return { key: String(s.api_key ?? ""), token: String(s.token ?? "") };
};

export async function syncTrello(tx: Tx, conn: Conn) {
  const { key, token } = await creds(tx, conn);
  const boards: any[] = await call(key, token, "/members/me/boards?filter=open&fields=name,url,idOrganization");
  for (const b of boards) await upsertObject(tx, conn, { kind: "trello_board", externalId: String(b.id), payload: { name: String(b.name), url: String(b.url ?? "") } });

  const maps = await tx.q<{ external_id: string; job_id: string }>("select external_id, job_id from connection_mappings where connection_id = $1 and job_id is not null", [conn.id]);
  let created = 0;
  let updated = 0;
  const people = await tx.q<{ id: string; name: string }>("select id, name from users where active");
  for (const m of maps) {
    const [lists, cards, members] = await Promise.all([
      call(key, token, `/boards/${m.external_id}/lists?filter=open&fields=name`),
      call(key, token, `/boards/${m.external_id}/cards/open?fields=name,desc,due,dueComplete,idList,idMembers,dateLastActivity`),
      call(key, token, `/boards/${m.external_id}/members?fields=fullName`),
    ]);
    const listName = new Map<string, string>(lists.map((l: any) => [l.id, String(l.name)]));
    const memberName = new Map<string, string>(members.map((u: any) => [u.id, String(u.fullName ?? "")]));
    for (const c of cards as any[]) {
      // The first member whose name matches someone on the team becomes the owner.
      const owner = (c.idMembers ?? []).map((id: string) => people.find((p) => p.name.trim().toLowerCase() === (memberName.get(id) ?? "").trim().toLowerCase())?.id).find(Boolean) ?? null;
      const status = cardStatus(listName.get(c.idList) ?? "", Boolean(c.dueComplete));
      const due = c.due ? String(c.due).slice(0, 10) : null;
      const title = String(c.name).slice(0, 200);
      const prior = await tx.one<{ matched_id: string | null }>("select matched_id from external_objects where connection_id = $1 and kind = 'trello_card' and external_id = $2", [conn.id, String(c.id)]);
      let taskId = prior?.matched_id ?? null;
      if (taskId) {
        const r = await tx.q(
          `update tasks set title = $2, due_date = $3, status = $4, assignee_id = coalesce($5, assignee_id), notes = $6,
                  completed_at = case when $4 = 'done' then coalesce(completed_at, now()) else null end
            where id = $1 and (title <> $2 or due_date is distinct from $3::date or status <> $4 or notes <> $6 or ($5::uuid is not null and assignee_id is distinct from $5::uuid)) returning 1`,
          [taskId, title, due, status, owner, String(c.desc ?? "").slice(0, 2000)],
        );
        updated += r.length;
      } else {
        taskId = (await tx.one<{ id: string }>(
          `insert into tasks (agency_id, job_id, title, notes, assignee_id, status, due_date, completed_at) values ($1,$2,$3,$4,$5,$6,$7, case when $6 = 'done' then now() end) returning id`,
          [tx.agencyId, m.job_id, title, String(c.desc ?? "").slice(0, 2000), owner, status, due],
        ))!.id;
        created++;
      }
      await upsertObject(tx, conn, { kind: "trello_card", externalId: String(c.id), payload: { name: title, list: listName.get(c.idList) ?? "", board: m.external_id }, matchedType: "task", matchedId: taskId });
    }
  }
  const unmapped = (await tx.one<{ n: number }>(
    "select count(*)::int as n from external_objects o where o.connection_id = $1 and o.kind = 'trello_board' and not exists (select 1 from connection_mappings m where m.connection_id = o.connection_id and m.external_id = o.external_id and m.job_id is not null)",
    [conn.id],
  ))!.n;
  return `${boards.length} boards read; ${created} new and ${updated} changed cards on ${maps.length} mapped boards${unmapped ? `; ${unmapped} boards still to map` : ""}`;
}

export async function trelloPanel(tx: Tx, conn: Pick<Conn, "id">) {
  return tx.q<{ external_id: string; name: string; cards: number; job_id: string | null; job_label: string | null }>(
    `select o.external_id, o.payload->>'name' as name,
            (select count(*)::int from external_objects c where c.connection_id = o.connection_id and c.kind = 'trello_card' and c.payload->>'board' = o.external_id) as cards,
            m.job_id, j.number || ' ' || j.name as job_label
       from external_objects o
       left join connection_mappings m on m.connection_id = o.connection_id and m.external_id = o.external_id
       left join jobs j on j.id = m.job_id
      where o.connection_id = $1 and o.kind = 'trello_board'
      order by (m.job_id is null) desc, o.payload->>'name'`,
    [conn.id],
  );
}

/** A board becomes a job awaiting scope (or maps to a job you already have), and its cards are pulled straight away. */
export async function mapTrelloBoard(tx: Tx, conn: Conn, boardId: string, target: { companyId?: string; newClientName?: string; existingJobId?: string; jobName?: string }) {
  const b = await tx.one<{ payload: { name: string } }>("select payload from external_objects where connection_id = $1 and kind = 'trello_board' and external_id = $2", [conn.id, boardId]);
  if (!b) throw new ConnectorError("That Trello board is no longer in the last sync. Sync again.");
  let jobId = target.existingJobId ?? "";
  let companyId = target.companyId ?? null;
  if (jobId) {
    companyId = (await tx.one<{ company_id: string }>("select company_id from jobs where id = $1", [jobId]))?.company_id ?? null;
  } else {
    companyId = companyId || (await clientNamed(tx, target.newClientName || b.payload.name));
    jobId = await jobAwaitingScope(tx, companyId, target.jobName?.trim() || b.payload.name, true);
  }
  await mapExternal(tx, conn, boardId, b.payload.name, { companyId, jobId });
  await tx.audit("connector.mapped", "connection", conn.id, undefined, { provider: "trello", board: b.payload.name, job_id: jobId });
  return jobId;
}

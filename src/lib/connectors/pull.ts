import type { Tx } from "../db";
import { createCompany } from "../services/agency";
import { createJob } from "../services/jobs";
import type { Conn } from "./connections";

// What every "pull from another tool" connector needs: turn a project or board
// into a job that is waiting for its scope, and remember what maps to what.

export async function clientNamed(tx: Tx, name: string) {
  const found = await tx.one<{ id: string }>("select id from companies where lower(name) = lower($1) and kind = 'client'", [name.trim()]);
  if (found) return found.id;
  const id = await createCompany(tx, { name: name.trim() });
  await tx.q("update companies set status = 'active' where id = $1", [id]);
  return id;
}

/**
 * A live job for imported work with no scope yet. It isn't locked, so the owner
 * adds the scope (or has it drafted from the quote) and approves it. Until then
 * the job shows as "needs scope".
 */
export async function jobAwaitingScope(tx: Tx, companyId: string, name: string, billable: boolean) {
  const id = await createJob(tx, { company_id: companyId, name, billing_model: billable ? "tm" : "internal", template_key: "blank", budget_hours: 0 });
  await tx.q("update jobs set status = 'in_progress' where id = $1", [id]);
  return id;
}

export async function mapExternal(tx: Tx, conn: Pick<Conn, "id">, externalId: string, label: string, target: { companyId?: string | null; jobId?: string | null; settings?: object }) {
  await tx.q(
    `insert into connection_mappings (agency_id, connection_id, external_id, external_label, company_id, job_id, settings) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (connection_id, external_id) do update set external_label = excluded.external_label, company_id = excluded.company_id, job_id = excluded.job_id, settings = connection_mappings.settings || excluded.settings`,
    [tx.agencyId, conn.id, externalId, label.slice(0, 200), target.companyId ?? null, target.jobId ?? null, JSON.stringify(target.settings ?? {})],
  );
}

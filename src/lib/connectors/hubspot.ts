import type { Tx } from "../db";
import { addContact, createCompany } from "../services/agency";
import { notify, usersWithRoles } from "../services/core";
import { createJob } from "../services/jobs";
import { api, upsertObject, type Conn } from "./connections";

// Closed-won deals in HubSpot become a client (with its contacts) and a job
// from the agency's chosen template. Only deals won after connecting count.

/* eslint-disable @typescript-eslint/no-explicit-any */
const HS = "https://api.hubapi.com";

async function associated(tx: Tx, conn: Conn, dealId: string, to: "companies" | "contacts"): Promise<string[]> {
  const r = await api(tx, conn, `${HS}/crm/v4/objects/deals/${dealId}/associations/${to}`);
  return (r.results ?? []).map((x: any) => String(x.toObjectId));
}

/** The 8gency client for a HubSpot company: one we made before, one with the same name, or a new one. */
async function clientFor(tx: Tx, conn: Conn, hsCompanyId: string | null, fallbackName: string) {
  if (hsCompanyId) {
    const seen = await tx.one<{ matched_id: string }>("select matched_id from external_objects where connection_id = $1 and kind = 'company' and external_id = $2", [conn.id, hsCompanyId]);
    if (seen) return { id: seen.matched_id, created: false };
  }
  const props = hsCompanyId ? (await api(tx, conn, `${HS}/crm/v3/objects/companies/${hsCompanyId}?properties=name,domain`)).properties : {};
  const name = String(props?.name || fallbackName).trim();
  const existing = await tx.one<{ id: string }>("select id from companies where lower(name) = lower($1) limit 1", [name]);
  const id = existing?.id ?? (await createCompany(tx, { name }));
  if (hsCompanyId) await upsertObject(tx, conn, { kind: "company", externalId: hsCompanyId, payload: props ?? {}, matchedType: "company", matchedId: id });
  return { id, created: !existing };
}

export async function syncHubspot(tx: Tx, conn: Conn) {
  const since = conn.cursor ?? String(conn.created_at.getTime());
  const r = await api(tx, conn, `${HS}/crm/v3/objects/deals/search`, {
    method: "POST",
    json: {
      filterGroups: [{ filters: [{ propertyName: "hs_is_closed_won", operator: "EQ", value: "true" }, { propertyName: "hs_lastmodifieddate", operator: "GTE", value: since }] }],
      properties: ["dealname", "amount", "closedate", "hs_lastmodifieddate"],
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "ASCENDING" }],
      limit: 50,
    },
  });
  const deals: any[] = r.results ?? [];
  let jobs = 0;
  let cursor = since;
  for (const d of deals) {
    cursor = String(Date.parse(d.properties.hs_lastmodifieddate) || cursor);
    if (await tx.one("select 1 from external_objects where connection_id = $1 and kind = 'deal' and external_id = $2", [conn.id, d.id])) continue;
    const name = String(d.properties.dealname || "New deal").trim();
    const [hsCompany] = await associated(tx, conn, d.id, "companies");
    const client = await clientFor(tx, conn, hsCompany ?? null, name);
    if (client.created) {
      const ids = (await associated(tx, conn, d.id, "contacts")).slice(0, 10);
      if (ids.length) {
        const people = await api(tx, conn, `${HS}/crm/v3/objects/contacts/batch/read`, { method: "POST", json: { properties: ["firstname", "lastname", "email", "phone"], inputs: ids.map((id) => ({ id })) } });
        for (const [i, p] of (people.results ?? []).entries()) {
          const full = [p.properties.firstname, p.properties.lastname].filter(Boolean).join(" ") || p.properties.email;
          if (full) await addContact(tx, { company_id: client.id, name: full, email: p.properties.email ?? "", phone: p.properties.phone ?? "", role: i === 0 ? "approver" : "commenter" });
        }
      }
    }
    const amount = Math.round(Number(d.properties.amount || 0) * 100);
    const jobId = await createJob(tx, { company_id: client.id, name, template_key: conn.settings.template_key || "blank", fee_cents: amount });
    await upsertObject(tx, conn, { kind: "deal", externalId: d.id, on: d.properties.closedate?.slice(0, 10) ?? null, payload: d.properties, matchedType: "job", matchedId: jobId });
    await notify(tx, await usersWithRoles(tx, ["owner", "ops"]), {
      kind: "connector",
      title: `Won in HubSpot: ${name}`,
      body: client.created ? "New client and job created: add the brief to get started." : "Job created for an existing client: add the brief to get started.",
      href: `/app/jobs/${jobId}`,
      dedupe: `hubspot:${d.id}`,
    });
    jobs++;
  }
  await tx.q("update connections set cursor = $2 where id = $1", [conn.id, cursor]);
  return `${jobs} won deals turned into jobs`;
}

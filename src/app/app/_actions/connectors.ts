"use server";
import { randomBytes } from "node:crypto";
import { act, bool, num, str, withParam } from "@/lib/actions";
import { requireUser, tenant } from "@/lib/auth";
import type { Tx } from "@/lib/db";
import { disconnect, readSecret, saveConnection, updateSettings, type Conn } from "@/lib/connectors/connections";
import { deliverOutbox } from "@/lib/connectors/delivery";
import { folderId } from "@/lib/connectors/files";
import { provider, type ProviderDef } from "@/lib/connectors/providers";
import { syncConnection } from "@/lib/connectors/sync";
import { applyToggl, checkTogglToken, mapTogglProject, matchTogglPerson } from "@/lib/connectors/toggl";
import { checkTrello, mapTrelloBoard } from "@/lib/connectors/trello";
import { suggestClient } from "@/lib/domain/imports";
import { GRAPH } from "@/lib/connectors/versions";
import { CONNECTORS } from "@/lib/domain/connectors";
import { can } from "@/lib/permissions";
import { UserError } from "@/lib/services/core";

type User = Awaited<ReturnType<typeof requireUser>>;

/** "We want this": records (or withdraws) the agency's interest in a connector, to prioritise the roadmap. */
export async function toggleConnectorRequestAction(fd: FormData) {
  const user = await requireUser();
  const key = str(fd, "connector");
  await act("/app/connectors", () =>
    tenant(user, async (tx) => {
      const c = CONNECTORS.find((x) => x.key === key);
      if (!c) throw new UserError("Unknown connector.");
      const removed = await tx.q("delete from connector_requests where connector = $1 returning connector", [key]);
      if (!removed.length) {
        await tx.q("insert into connector_requests (agency_id, connector, user_id) values ($1,$2,$3)", [tx.agencyId, key, user.id]);
        await tx.audit("connector.requested", "connector", null, undefined, { connector: c.name });
      }
      return `/app/connectors#${key}`;
    }),
  );
}

/** Agency-wide connections are managed by owners and ops; personal ones by the person who owns them. */
async function ownConnection(tx: Tx, user: User, id: string) {
  const c = await tx.one<Conn>("select * from connections where id = $1", [id]);
  if (!c) throw new UserError("That connection no longer exists.");
  if (c.user_id ? c.user_id !== user.id && !can(user, "settings") : !can(user, "settings")) throw new UserError("Only owners and operations can change agency-wide connections.");
  return { conn: c, def: provider(c.provider)! };
}

const backTo = (def: ProviderDef) => `/app/connectors/${def.catalog}`;

/** Check pasted keys against the provider before saving them, so mistakes show up now rather than on the first payment. */
async function checkKeys(def: ProviderDef, s: Record<string, string | boolean>): Promise<string> {
  const bearer = (token: unknown) => ({ headers: { authorization: `Bearer ${token}` } });
  if (def.key === "whatsapp") {
    const r = await fetch(`https://graph.facebook.com/${GRAPH}/${encodeURIComponent(String(s.phone_number_id))}?fields=display_phone_number,verified_name`, bearer(s.access_token));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new UserError(`WhatsApp didn't accept those details: ${j.error?.message ?? r.status}`);
    return `${j.verified_name ?? "WhatsApp"} · ${j.display_phone_number ?? ""}`.trim();
  }
  if (def.key === "toggl") return (await checkTogglToken(String(s.api_token)).catch((e) => { throw new UserError(e.message); })).label;
  if (def.key === "trello") return await checkTrello(String(s.api_key), String(s.token)).catch((e) => { throw new UserError(e.message); });
  if (def.key === "stripe") {
    const r = await fetch("https://api.stripe.com/v1/account", bearer(s.secret_key));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new UserError(`Stripe didn't accept that key: ${j.error?.message ?? r.status}`);
    return `${j.settings?.dashboard?.display_name || j.business_profile?.name || j.email || "Stripe"}${String(s.secret_key).startsWith("sk_test") ? " (test mode)" : ""}`;
  }
  if (def.key === "paystack") {
    const r = await fetch("https://api.paystack.co/balance", bearer(s.secret_key));
    if (!r.ok) throw new UserError("Paystack didn't accept that secret key.");
    return `Paystack${String(s.secret_key).startsWith("sk_test") ? " (test mode)" : ""}`;
  }
  return `Merchant ${s.merchant_id}${s.sandbox ? " (sandbox)" : ""}`;
}

export async function saveKeysAction(fd: FormData) {
  const user = await requireUser();
  const def = provider(str(fd, "provider"));
  if (!def || def.auth.kind !== "apikey") throw new Error("Unknown connector");
  const fields = def.auth.fields;
  await act(backTo(def), () =>
    tenant(user, async (tx) => {
      if (!can(user, "settings")) throw new UserError("Only owners and operations can connect agency-wide apps.");
      const existing = await tx.one<{ id: string; settings: Record<string, unknown> }>("select id, settings from connections where provider = $1 and user_id is null", [def.key]);
      const old = existing ? await readSecret(tx, existing.id).catch(() => ({})) : {};
      // Secret fields left blank keep their saved value, so they never have to be shown again.
      const secret: Record<string, string | boolean> = { ...old };
      for (const f of fields) {
        if (f.checkbox) secret[f.key] = bool(fd, f.key);
        else if (str(fd, f.key) || !f.secret) secret[f.key] = str(fd, f.key);
      }
      const missing = fields.filter((f) => !f.checkbox && !f.label.includes("optional") && !secret[f.key]);
      if (missing.length) throw new UserError(`Fill in ${missing.map((f) => f.label.toLowerCase()).join(", ")}.`);
      const label = await checkKeys(def, secret);
      await saveConnection(tx, {
        provider: def.key,
        userId: null,
        label,
        secret,
        settings: def.key === "whatsapp" && !existing?.settings?.verify_token ? { verify_token: randomBytes(18).toString("base64url") } : {},
      });
    }),
  `${def.name} connected.`);
}

export async function disconnectAction(fd: FormData) {
  const user = await requireUser();
  let back = "/app/connectors";
  await act(back, () =>
    tenant(user, async (tx) => {
      const { conn, def } = await ownConnection(tx, user, str(fd, "id"));
      back = backTo(def);
      await disconnect(tx, conn.id);
      return back;
    }),
  "Disconnected, and everything synced from it was deleted.");
}

export async function syncNowAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "id");
  await act("/app/connectors", async () => {
    const { def } = await tenant(user, async (tx) => {
      const own = await ownConnection(tx, user, id);
      await tx.q("update connections set next_sync_at = now() where id = $1", [id]);
      return own;
    });
    const r = await syncConnection(user.agency_id, id);
    const sent = await deliverOutbox(user.agency_id);
    const outbox = sent ? ` ${sent} queued ${sent === 1 ? "message" : "messages"} sent.` : "";
    if (!r.ok && r.summary !== "Nothing to sync.") throw new UserError(`Sync failed: ${r.summary}`);
    return withParam(backTo(def), "ok", r.ok ? `Synced: ${r.summary}.${outbox}` : `Up to date.${outbox}`);
  });
}

/** Per-provider settings that can be changed from the connector page. */
const SETTINGS: Record<string, string[]> = {
  outlook: ["send_outbox"],
  slack: ["default_channel"],
  xero: ["account_code", "tax_type", "zero_tax_type", "push_from"],
  quickbooks: ["item_id", "tax_code", "push_from"],
  google_ads: ["login_customer_id"],
  hubspot: ["template_key"],
};

export async function saveConnectorSettingsAction(fd: FormData) {
  const user = await requireUser();
  await act("/app/connectors", () =>
    tenant(user, async (tx) => {
      const { conn, def } = await ownConnection(tx, user, str(fd, "id"));
      const patch: Record<string, unknown> = {};
      for (const k of SETTINGS[conn.provider] ?? []) {
        if (k === "send_outbox") {
          if (!can(user, "settings")) throw new UserError("Only owners and operations choose the Outbox mailbox.");
          patch[k] = bool(fd, k);
        } else if (k === "default_channel") {
          const [id, label] = str(fd, k).split("|");
          patch.default_channel = id || null;
          patch.default_channel_label = label ?? "";
        } else if (k === "push_from") patch[k] = /^\d{4}-\d{2}-\d{2}$/.test(str(fd, k)) ? str(fd, k) : null;
        else patch[k] = str(fd, k).slice(0, 100);
      }
      await updateSettings(tx, conn.id, patch);
      await tx.audit("connector.settings", "connection", conn.id, undefined, { provider: conn.provider, ...patch });
      return backTo(def);
    }),
  "Saved.");
}

/** Map a provider object (channel, ad account, property, folder) to a client or job. */
export async function saveMappingAction(fd: FormData) {
  const user = await requireUser();
  await act("/app/connectors", () =>
    tenant(user, async (tx) => {
      const { conn, def } = await ownConnection(tx, user, str(fd, "connection_id"));
      let externalId = str(fd, "external_id");
      let label = str(fd, "external_label");
      if (externalId.includes("|")) [externalId, label] = externalId.split("|");
      if (conn.provider === "google_drive" || conn.provider === "dropbox") {
        label = str(fd, "folder");
        externalId = folderId(conn.provider, label) ?? "";
        if (!externalId) throw new UserError(conn.provider === "google_drive" ? "Paste a Google Drive folder link." : "Enter a Dropbox folder path, e.g. /Clients/Vela.");
      }
      if (!externalId) throw new UserError("Choose what to map.");
      let companyId = str(fd, "company_id") || null;
      const jobId = str(fd, "job_id") || null;
      if (jobId) companyId = (await tx.one<{ company_id: string }>("select company_id from jobs where id = $1", [jobId]))?.company_id ?? null;
      if (!companyId) throw new UserError(jobId === null && fd.has("job_id") ? "Choose the job its spend belongs to." : "Choose a client.");
      const settings = { markup: Math.max(0, Math.min(1, num(fd, "markup") / 100)), monthly_budget: Math.max(0, num(fd, "monthly_budget")) };
      await tx.q(
        `insert into connection_mappings (agency_id, connection_id, external_id, external_label, company_id, job_id, settings) values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (connection_id, external_id) do update set external_label = excluded.external_label, company_id = excluded.company_id, job_id = excluded.job_id, settings = excluded.settings`,
        [tx.agencyId, conn.id, externalId.slice(0, 300), label.slice(0, 200), companyId, jobId, JSON.stringify(settings)],
      );
      await tx.audit("connector.mapped", "connection", conn.id, undefined, { provider: conn.provider, external: label || externalId, company_id: companyId, job_id: jobId });
      return backTo(def);
    }),
  "Mapping saved.");
}

export async function deleteMappingAction(fd: FormData) {
  const user = await requireUser();
  await act("/app/connectors", () =>
    tenant(user, async (tx) => {
      const m = await tx.one<{ connection_id: string }>("select connection_id from connection_mappings where id = $1", [str(fd, "id")]);
      if (!m) throw new UserError("That mapping no longer exists.");
      const { def } = await ownConnection(tx, user, m.connection_id);
      await tx.q("delete from connection_mappings where id = $1", [str(fd, "id")]);
      return backTo(def);
    }),
  "Mapping removed.");
}

export async function deliverNowAction() {
  const user = await requireUser();
  await act("/app/outbox", async () => {
    if (!can(user, "settings")) throw new UserError("Only owners and operations can send the Outbox.");
    const sent = await deliverOutbox(user.agency_id);
    return withParam("/app/outbox", "ok", sent ? `${sent} sent.` : "Nothing could be sent yet: connect the apps they're waiting for.");
  });
}

// ── Pulling work in from Toggl and Trello: the owner confirms what becomes a job ──

async function connOf(tx: Tx, user: User, id: string) {
  const { conn, def } = await ownConnection(tx, user, id);
  return { conn, back: backTo(def) };
}

/** A Toggl project becomes a job awaiting its scope, under an existing client or a new one. */
export async function mapTogglProjectAction(fd: FormData) {
  const user = await requireUser();
  let back = "/app/connectors/toggl";
  await act(back, () =>
    tenant(user, async (tx) => {
      const c = await connOf(tx, user, str(fd, "connection_id"));
      back = c.back;
      await mapTogglProject(tx, c.conn, str(fd, "project_id"), { companyId: str(fd, "company_id") || undefined, newClientName: str(fd, "client_name") || undefined });
      await applyToggl(tx, c.conn);
      return back;
    }),
  "Job created. Its time is on it now.");
}

/** One click for every project that has a client: match existing clients by name, create the rest. */
export async function mapAllTogglProjectsAction(fd: FormData) {
  const user = await requireUser();
  let back = "/app/connectors/toggl";
  let made = 0;
  let skipped = 0;
  await act(back, async () => {
    await tenant(user, async (tx) => {
      const c = await connOf(tx, user, str(fd, "connection_id"));
      back = c.back;
      const clients = await tx.q<{ id: string; name: string }>("select id, name from companies where kind = 'client'");
      const todo = await tx.q<{ external_id: string; payload: { client: string; name: string } }>(
        `select o.external_id, o.payload from external_objects o where o.connection_id = $1 and o.kind = 'toggl_project' and (o.payload->>'active')::boolean
            and not exists (select 1 from connection_mappings m where m.connection_id = o.connection_id and m.external_id = o.external_id and m.job_id is not null)`,
        [c.conn.id],
      );
      for (const p of todo) {
        if (!p.payload.client) {
          skipped++;
          continue;
        }
        await mapTogglProject(tx, c.conn, p.external_id, { companyId: suggestClient(p.payload.name, clients, p.payload.client) ?? undefined, newClientName: p.payload.client });
        made++;
      }
      await applyToggl(tx, c.conn);
    });
    return withParam(back, "ok", `${made} ${made === 1 ? "job" : "jobs"} created from Toggl projects.${skipped ? ` ${skipped} projects have no client in Toggl: map those one by one.` : ""}`);
  });
}

export async function matchTogglPersonAction(fd: FormData) {
  const user = await requireUser();
  let back = "/app/connectors/toggl";
  await act(back, () =>
    tenant(user, async (tx) => {
      const c = await connOf(tx, user, str(fd, "connection_id"));
      back = c.back;
      await matchTogglPerson(tx, c.conn, str(fd, "toggl_user_id"), str(fd, "user_id"));
      await applyToggl(tx, c.conn);
      return back;
    }),
  "Saved.");
}

/** A Trello board becomes a job awaiting scope (or maps to a job you already have); its cards are pulled straight away. */
export async function mapTrelloBoardAction(fd: FormData) {
  const user = await requireUser();
  let back = "/app/connectors/trello";
  const id = str(fd, "connection_id");
  await act(back, async () => {
    await tenant(user, async (tx) => {
      const c = await connOf(tx, user, id);
      back = c.back;
      await mapTrelloBoard(tx, c.conn, str(fd, "board_id"), {
        companyId: str(fd, "company_id") || undefined,
        newClientName: str(fd, "client_name") || undefined,
        existingJobId: str(fd, "job_id") || undefined,
        jobName: str(fd, "job_name") || undefined,
      });
    });
    const r = await syncConnection(user.agency_id, id);
    return withParam(back, "ok", r.ok ? `Board mapped. ${r.summary}.` : "Board mapped. Its cards arrive at the next sync.");
  });
}

import type { Tx } from "../db";
import { notify, usersWithRoles } from "../services/core";
import { seal, unseal } from "../vault";
import { oauthRedirectUri, provider, type OAuthDef, type ProviderDef, type ProviderKey } from "./providers";

export class ConnectorError extends Error {}
/** Access was refused: the caller marks the connection for reconnecting (after any rollback). */
export class ReauthError extends ConnectorError {
  constructor(
    public conn: Conn,
    message: string,
  ) {
    super(message);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Conn {
  id: string;
  provider: ProviderKey;
  user_id: string | null;
  account_label: string;
  external_account_id: string;
  scopes: string[];
  status: "active" | "needs_reauth";
  settings: Record<string, any>;
  cursor: string | null;
  token_expires_at: Date | null;
  last_sync_at: Date | null;
  last_error: string | null;
  connected_by: string | null;
  created_at: Date;
}
export type Secret = Record<string, any> & { access_token?: string; refresh_token?: string };

const COLS = "id, provider, user_id, account_label, external_account_id, scopes, status, settings, cursor, token_expires_at, last_sync_at, last_error, connected_by, created_at";

export const listConnections = (tx: Tx) => tx.q<Conn>(`select ${COLS} from connections order by created_at`);

/** The agency-wide connection for a provider, or a person's own one for personal providers. */
export function getConnection(tx: Tx, key: ProviderKey, userId: string | null = null) {
  return tx.one<Conn>(`select ${COLS} from connections where provider = $1 and user_id is not distinct from $2`, [key, userId]);
}

/** A working connection, or null: what features check before using a provider. */
export async function activeConnection(tx: Tx, key: ProviderKey, userId: string | null = null) {
  const c = await getConnection(tx, key, userId);
  return c?.status === "active" ? c : null;
}

export async function saveConnection(
  tx: Tx,
  c: { provider: ProviderKey; userId: string | null; label: string; externalId?: string; scopes?: string[]; secret: Secret; expiresIn?: number | null; settings?: Record<string, unknown> },
) {
  const row = await tx.one<{ id: string }>(
    `insert into connections (agency_id, provider, user_id, account_label, external_account_id, scopes, secret, token_expires_at, settings, connected_by)
     values ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(secs => $8), $9, $10)
     on conflict (agency_id, provider, (coalesce(user_id, '00000000-0000-0000-0000-000000000000'))) do update
       set account_label = excluded.account_label, external_account_id = excluded.external_account_id, scopes = excluded.scopes,
           secret = excluded.secret, token_expires_at = excluded.token_expires_at, settings = connections.settings || excluded.settings,
           status = 'active', failures = 0, last_error = null, next_sync_at = now()
     returning id`,
    [tx.agencyId, c.provider, c.userId, c.label, c.externalId ?? "", c.scopes ?? [], seal(c.secret), c.expiresIn ?? null, JSON.stringify(c.settings ?? {}), tx.userId],
  );
  await tx.audit("connector.connected", "connection", row!.id, undefined, { provider: c.provider, account: c.label });
  return row!.id;
}

export async function readSecret(tx: Tx, connId: string): Promise<Secret> {
  const row = await tx.one<{ secret: Buffer | null }>("select secret from connections where id = $1", [connId]);
  if (!row?.secret) throw new ConnectorError("This connection has no saved credentials. Connect it again.");
  return unseal<Secret>(row.secret);
}

export async function updateSettings(tx: Tx, connId: string, patch: Record<string, unknown>) {
  await tx.q("update connections set settings = settings || $2 where id = $1", [connId, JSON.stringify(patch)]);
}

/** Disconnect and delete everything synced from the app. Records already created in 8gency (clients, costs, payments) stay. */
export async function disconnect(tx: Tx, connId: string) {
  const c = await tx.one<{ provider: string; account_label: string }>("delete from connections where id = $1 returning provider, account_label", [connId]);
  if (c) await tx.audit("connector.disconnected", "connection", connId, { provider: c.provider, account: c.account_label }, undefined);
}

/** Stop using a connection whose access was revoked or expired, and tell whoever can fix it. */
export async function markNeedsReauth(tx: Tx, conn: Conn, reason: string) {
  await tx.q("update connections set status = 'needs_reauth', last_error = $2 where id = $1", [conn.id, reason.slice(0, 500)]);
  const name = provider(conn.provider)?.name ?? conn.provider;
  const who = conn.user_id ? [conn.user_id] : [conn.connected_by, ...(await usersWithRoles(tx, ["owner"]))];
  await notify(tx, who, { kind: "connector", title: `Reconnect ${name}`, body: reason.slice(0, 200), href: "/app/connectors#" + (provider(conn.provider)?.catalog ?? ""), dedupe: `reauth:${conn.id}:${conn.token_expires_at?.toISOString() ?? ""}` });
}

// ── OAuth ────────────────────────────────────────────────────────────────

const oauthOf = (p: ProviderDef) => {
  if (p.auth.kind !== "oauth") throw new ConnectorError(`${p.name} doesn't use sign-in.`);
  return p.auth;
};

export function authorizeUrl(p: ProviderDef, state: string) {
  const o = oauthOf(p);
  const q = new URLSearchParams({
    client_id: process.env[`${o.app}_CLIENT_ID`] ?? "",
    redirect_uri: oauthRedirectUri(),
    response_type: "code",
    state,
    [o.scopeParam ?? "scope"]: o.scopes.join(o.scopeSep ?? " "),
    ...o.params,
  });
  return `${o.authUrl}?${q}`;
}

async function tokenRequest(o: OAuthDef, params: Record<string, string>, url = o.tokenUrl): Promise<Secret & { expires_in?: number }> {
  const id = process.env[`${o.app}_CLIENT_ID`] ?? "";
  const secret = process.env[`${o.app}_CLIENT_SECRET`] ?? "";
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  const body = new URLSearchParams(params);
  if (o.clientAuth === "basic") headers.authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
  else {
    body.set("client_id", id);
    body.set("client_secret", secret);
  }
  const res = await fetch(url, { method: "POST", headers, body });
  const json = (await res.json().catch(() => ({}))) as Secret & { error?: string; error_description?: string; ok?: boolean };
  if (!res.ok || json.error || json.ok === false) throw new ConnectorError(`Sign-in failed: ${json.error_description ?? json.error ?? res.status}`);
  return json;
}

export const exchangeCode = (p: ProviderDef, code: string) => tokenRequest(oauthOf(p), { grant_type: "authorization_code", code, redirect_uri: oauthRedirectUri() });

/** A valid access token, refreshed and re-saved when it is about to expire. */
export async function accessToken(tx: Tx, conn: Conn, force = false): Promise<string> {
  const s = await readSecret(tx, conn.id);
  const p = provider(conn.provider)!;
  const expiring = conn.token_expires_at && conn.token_expires_at.getTime() < Date.now() + 60_000;
  if (p.auth.kind === "oauth" && (expiring || force)) {
    if (!s.refresh_token) throw new ReauthError(conn, `${p.name} access expired. Connect it again to keep it working.`);
    let t;
    try {
      t = await tokenRequest(p.auth, { grant_type: "refresh_token", refresh_token: s.refresh_token }, p.auth.refreshUrl);
    } catch (e) {
      throw new ReauthError(conn, (e as Error).message);
    }
    const next = { ...s, ...t, refresh_token: t.refresh_token ?? s.refresh_token };
    await tx.q("update connections set secret = $2, token_expires_at = now() + make_interval(secs => $3) where id = $1", [conn.id, seal(next), t.expires_in ?? null]);
    conn.token_expires_at = t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null;
    return next.access_token!;
  }
  if (!s.access_token) throw new ConnectorError(`${p.name} has no access token.`);
  return s.access_token;
}

/**
 * Call a provider API with the connection's token. Refreshes once on 401;
 * if that fails too, the connection is flagged for reconnecting.
 */
export async function api<T = any>(tx: Tx, conn: Conn, url: string, init: RequestInit & { json?: unknown; raw?: boolean } = {}): Promise<T> {
  const go = async (token: string) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    if (init.json !== undefined) headers.set("content-type", "application/json");
    if (!headers.has("accept")) headers.set("accept", "application/json");
    return fetch(url, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  };
  let res = await go(await accessToken(tx, conn));
  if (res.status === 401 && provider(conn.provider)?.auth.kind === "oauth") res = await go(await accessToken(tx, conn, true));
  if (res.status === 401) throw new ReauthError(conn, `${provider(conn.provider)?.name} turned down 8gency's access. Connect it again.`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ConnectorError(`${provider(conn.provider)?.name} said ${res.status}: ${text.slice(0, 300)}`);
  }
  if (init.raw) return res as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** Insert or refresh a synced item. Existing matches are kept unless a new one is given. */
export async function upsertObject(
  tx: Tx,
  conn: Pick<Conn, "id">,
  o: { kind: string; externalId: string; on?: string | null; payload: unknown; matchedType?: string | null; matchedId?: string | null },
) {
  return (await tx.one<{ id: string; inserted: boolean; matched_type: string | null; matched_id: string | null }>(
    `insert into external_objects (agency_id, connection_id, kind, external_id, occurred_on, payload, matched_type, matched_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (connection_id, kind, external_id) do update
       set payload = excluded.payload, occurred_on = excluded.occurred_on, updated_at = now(),
           matched_type = coalesce(excluded.matched_type, external_objects.matched_type), matched_id = coalesce(excluded.matched_id, external_objects.matched_id)
     returning id, (xmax = 0) as inserted, matched_type, matched_id`,
    [tx.agencyId, conn.id, o.kind, o.externalId, o.on ?? null, JSON.stringify(o.payload), o.matchedType ?? null, o.matchedId ?? null],
  ))!;
}

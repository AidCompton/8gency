import { Pool, type PoolClient, types } from "pg";

// int8 and numeric come back as strings by default. Amounts are stored in cents
// and stay well inside Number.MAX_SAFE_INTEGER, so parse them as numbers.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));
// Keep DATE columns as YYYY-MM-DD strings; never shift them through a JS Date.
types.setTypeParser(1082, (v) => v);

type Globals = { __8gAppPool?: Pool; __8gAdminPool?: Pool };
const g = globalThis as Globals;

function appPool(): Pool {
  if (!g.__8gAppPool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    g.__8gAppPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  }
  return g.__8gAppPool;
}

function adminPool(): Pool {
  if (!g.__8gAdminPool) {
    if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL is not set");
    g.__8gAdminPool = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 4 });
  }
  return g.__8gAdminPool;
}

export type Row = Record<string, unknown>;

export interface Tx {
  agencyId: string;
  userId: string | null;
  actorLabel: string;
  q<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: unknown[]): Promise<T | null>;
  /** Append an immutable audit event (M27). */
  audit(action: string, recordType: string, recordId: string | null, before?: unknown, after?: unknown): Promise<void>;
}

export interface TenantContext {
  agencyId: string;
  userId?: string | null;
  actorLabel?: string;
}

function makeTx(client: PoolClient, ctx: TenantContext): Tx {
  const tx: Tx = {
    agencyId: ctx.agencyId,
    userId: ctx.userId ?? null,
    actorLabel: ctx.actorLabel ?? "system",
    async q<T>(sql: string, params: unknown[] = []) {
      return (await client.query(sql, params)).rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      return ((await client.query(sql, params)).rows[0] as T) ?? null;
    },
    async audit(action, recordType, recordId, before, after) {
      await client.query(
        `insert into audit_events (agency_id, actor_user_id, actor_label, action, record_type, record_id, before, after)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          ctx.agencyId,
          ctx.userId ?? null,
          ctx.actorLabel ?? "system",
          action,
          recordType,
          recordId,
          before === undefined ? null : JSON.stringify(before),
          after === undefined ? null : JSON.stringify(after),
        ],
      );
    },
  };
  return tx;
}

/**
 * Run `fn` in a transaction scoped to one agency. Row-level security policies
 * read `app.agency_id`, so queries inside can only see and write that tenant's rows.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await appPool().connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.agency_id', $1, true)", [ctx.agencyId]);
    const result = await fn(makeTx(client, ctx));
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Privileged access that bypasses RLS. Only for work that must happen before a
 * tenant is known: sign-up, login, session lookup and resolving external links.
 */
export async function adminQuery<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await adminPool().query(sql, params)).rows as T[];
}

export async function withAdminTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await adminPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function closePools() {
  await g.__8gAppPool?.end();
  await g.__8gAdminPool?.end();
  g.__8gAppPool = undefined;
  g.__8gAdminPool = undefined;
}

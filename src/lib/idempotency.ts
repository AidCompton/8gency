import { adminQuery } from "./db";

export type Idempotent<T> = { status: "ran" | "replayed"; value: T } | { status: "busy" };

/**
 * Run `fn` once per (scope, key). The same key again returns the first result without running `fn`;
 * the same key while the first is still running reports "busy". If `fn` throws, the key is released
 * so a corrected retry can go through. With no key it simply runs.
 */
export async function idempotent<T>(key: string | null | undefined, scope: string, fn: () => Promise<T>): Promise<Idempotent<T>> {
  if (!key || key.length > 255) return { status: "ran", value: await fn() };
  const claimed = await adminQuery("insert into idempotency_keys (scope, key) values ($1,$2) on conflict do nothing returning 1", [scope, key]);
  if (!claimed.length) {
    const [row] = await adminQuery<{ result: { value: T } | null }>("select result from idempotency_keys where scope = $1 and key = $2", [scope, key]);
    return row?.result ? { status: "replayed", value: row.result.value } : { status: "busy" };
  }
  try {
    const value = await fn();
    await adminQuery("update idempotency_keys set result = $3 where scope = $1 and key = $2", [scope, key, JSON.stringify({ value })]);
    return { status: "ran", value };
  } catch (e) {
    await adminQuery("delete from idempotency_keys where scope = $1 and key = $2", [scope, key]);
    throw e;
  }
}

/** Keys older than two days can't be retries any more. Run from the scheduler. */
export async function purgeIdempotencyKeys() {
  return (await adminQuery("delete from idempotency_keys where created_at < now() - interval '2 days' returning 1")).length;
}

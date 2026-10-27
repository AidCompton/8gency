import { adminQuery } from "./db";
import { UserError } from "./services/core";

// Throttling for things an attacker can repeat: password guesses, reset
// requests, waitlist spam. Attempts live in the database (not memory), so
// limits hold across servers and restarts.

type Kind = "login" | "reset_request" | "waitlist";

/**
 * The caller's IP, for throttling.
 * ponytail: trusts X-Forwarded-For; only correct behind our own proxy/load balancer that sets it. Check the hosting setup.
 */
export function clientIp(h: Headers) {
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

/** Refuse when `identifier` has failed `limit` times in the last `minutes`. A success clears the count when `resetOnSuccess`. */
export async function throttle(kind: Kind, identifier: string, limit: number, minutes: number, opts: { resetOnSuccess?: boolean } = {}) {
  const [row] = await adminQuery<{ n: number; first: Date | null }>(
    `select count(*)::int as n, min(created_at) as first from auth_attempts
      where kind = $1 and identifier = $2 and not ok
        and created_at > greatest(now() - make_interval(mins => $3)${opts.resetOnSuccess ? `, coalesce((select max(created_at) from auth_attempts where kind = $1 and identifier = $2 and ok), '-infinity')` : ""})`,
    [kind, identifier, minutes],
  );
  if (row.n >= limit) {
    const wait = Math.max(1, Math.ceil(minutes - (Date.now() - new Date(row.first!).getTime()) / 60_000));
    throw new UserError(`Too many attempts. Try again in about ${wait} ${wait === 1 ? "minute" : "minutes"}.`);
  }
}

export async function recordAttempt(kind: Kind, identifier: string, ok = false) {
  await adminQuery("insert into auth_attempts (kind, identifier, ok) values ($1,$2,$3)", [kind, identifier.slice(0, 200), ok]);
  if (Math.random() < 0.02) await adminQuery("delete from auth_attempts where created_at < now() - interval '2 days'");
}

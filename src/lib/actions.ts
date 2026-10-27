import "server-only";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "./auth";
import { idempotent } from "./idempotency";
import { recordUse } from "./usage";
import { ForbiddenError } from "./permissions";
import { UserError } from "./services/core";

export function withParam(url: string, key: string, value: string) {
  const [path, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.delete("error");
  params.delete("ok");
  params.set(key, value);
  return `${path}?${params.toString()}`;
}

/** The browser puts a fresh UUID in this cookie each time someone presses a submit button (see SubmitButton). */
export const IDEMPOTENCY_COOKIE = "8g_idem";

/**
 * Run a server-action body. Rule violations (UserError, permissions, database
 * check constraints) come back to the page as a readable message; everything
 * else is a real error and is rethrown.
 *
 * The press of a submit button carries an idempotency key. If the same press reaches the
 * server twice (a double click that got past the disabled button, a retried request), the
 * body runs once and the second one just lands where the first did.
 */
export async function act(back: string, fn: () => Promise<string | void>, ok?: string): Promise<never> {
  const jar = await cookies();
  const key = jar.get(IDEMPOTENCY_COOKIE)?.value;
  if (key) jar.delete(IDEMPOTENCY_COOKIE);
  let target: string;
  try {
    const r = await idempotent(key, "form", async () => (await fn()) || back);
    if (r.status === "busy") target = back;
    else target = r.value;
    if (r.status === "replayed") redirect(ok ? withParam(target, "ok", ok) : target);
  } catch (e) {
    if (isRedirect(e)) throw e;
    if (e instanceof UserError || e instanceof ForbiddenError) redirect(withParam(back, "error", e.message));
    const pg = e as { code?: string; constraint?: string };
    if (pg.code === "23514") redirect(withParam(back, "error", `That breaks an operating rule (${pg.constraint ?? "check"}).`));
    if (pg.code === "23505") redirect(withParam(back, "error", "That already exists."));
    throw e;
  }
  const user = await getSessionUser().catch(() => null);
  if (user) await recordUse(user.agency_id, back);
  revalidatePath("/app", "layout");
  redirect(ok ? withParam(target, "ok", ok) : target);
}

const isRedirect = (e: unknown) => typeof (e as { digest?: unknown })?.digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_REDIRECT");

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const num = (fd: FormData, k: string) => {
  const v = Number(String(fd.get(k) ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};
export const opt = (fd: FormData, k: string) => str(fd, k) || null;
export const bool = (fd: FormData, k: string) => ["on", "true", "1", "yes"].includes(str(fd, k));

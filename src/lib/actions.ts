import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

/**
 * Run a server-action body. Rule violations (UserError, permissions, database
 * check constraints) come back to the page as a readable message; everything
 * else is a real error and is rethrown.
 */
export async function act(back: string, fn: () => Promise<string | void>, ok?: string): Promise<never> {
  let target: string;
  try {
    target = (await fn()) || back;
  } catch (e) {
    if (e instanceof UserError || e instanceof ForbiddenError) redirect(withParam(back, "error", e.message));
    const pg = e as { code?: string; constraint?: string };
    if (pg.code === "23514") redirect(withParam(back, "error", `That breaks an operating rule (${pg.constraint ?? "check"}).`));
    if (pg.code === "23505") redirect(withParam(back, "error", "That already exists."));
    throw e;
  }
  revalidatePath("/app", "layout");
  redirect(ok ? withParam(target, "ok", ok) : target);
}

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const num = (fd: FormData, k: string) => {
  const v = Number(String(fd.get(k) ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};
export const opt = (fd: FormData, k: string) => str(fd, k) || null;
export const bool = (fd: FormData, k: string) => ["on", "true", "1", "yes"].includes(str(fd, k));

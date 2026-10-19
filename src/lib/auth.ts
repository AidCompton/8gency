import "server-only";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { adminQuery, withTenant, type Tx } from "./db";
import { can, type Capability, type Role } from "./permissions";

const COOKIE = "8g_session";
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  agency_id: string;
  email: string;
  name: string;
  role: Role;
  title: string;
  agency_name: string;
  agency_color: string;
  timezone: string;
  base_currency: string;
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string, agencyId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await adminQuery("insert into sessions (token_hash, user_id, agency_id, expires_at) values ($1,$2,$3,$4)", [
    hashToken(token),
    userId,
    agencyId,
    expires,
  ]);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await adminQuery("delete from sessions where token_hash = $1", [hashToken(token)]);
  jar.delete(COOKIE);
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const rows = await adminQuery<SessionUser>(
    `select u.id, u.agency_id, u.email, u.name, u.role, u.title,
            a.name as agency_name, a.brand_color as agency_color, a.timezone, a.base_currency
       from sessions s
       join users u on u.id = s.user_id and u.active
       join agencies a on a.id = s.agency_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Run a tenant-scoped transaction as the signed-in user. */
export async function tenant<T>(user: SessionUser, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant({ agencyId: user.agency_id, userId: user.id, actorLabel: user.name }, fn);
}

/** For pages: send users without a capability back to My Day with a message, rather than an error page. */
export function requireCap(user: SessionUser, cap: Capability) {
  if (!can(user, cap)) redirect(`/app/my-day?error=${encodeURIComponent("You don't have access to that page. Ask an owner or operations lead if you need it.")}`);
}

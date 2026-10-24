"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { act, str } from "@/lib/actions";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { adminQuery, withAdminTx } from "@/lib/db";
import { createAgencyWithOwner } from "@/lib/services/agency";
import { UserError } from "@/lib/services/core";
import { AGENCY_TYPES, type AgencyType } from "@/lib/templates";

export async function login(fd: FormData) {
  await act("/login", async () => {
    const email = str(fd, "email").toLowerCase();
    const [user] = await adminQuery<{ id: string; agency_id: string; password_hash: string }>(
      "select id, agency_id, password_hash from users where lower(email) = $1 and active",
      [email],
    );
    // Same message for unknown email and wrong password.
    if (!user || !(await verifyPassword(str(fd, "password"), user.password_hash))) throw new UserError("That email and password don't match.");
    await createSession(user.id, user.agency_id);
    return "/app";
  });
}

const SignUp = z.object({
  agencyName: z.string().min(2, "Agency name is required"),
  agencyType: z.enum(AGENCY_TYPES.map((t) => t.key) as [AgencyType, ...AgencyType[]]),
  ownerName: z.string().min(2, "Your name is required"),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters for your password"),
});

export async function signup(fd: FormData) {
  await act("/signup", async () => {
    const parsed = SignUp.safeParse(Object.fromEntries(fd));
    if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
    const passwordHash = await hashPassword(parsed.data.password);
    const { agencyId, userId } = await withAdminTx((c) => createAgencyWithOwner(c, { ...parsed.data, passwordHash }));
    await createSession(userId, agencyId);
    return "/app/settings?tab=import&welcome=1";
  });
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

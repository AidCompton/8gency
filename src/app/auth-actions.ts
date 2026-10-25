"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { act, str } from "@/lib/actions";
import { createSession, destroySession } from "@/lib/auth";
import { clientIp, recordAttempt, throttle } from "@/lib/security";
import { acceptStaffInvite, checkLogin, joinWaitlist, requestPasswordReset, resetPassword, signupWithInvite } from "@/lib/services/accountAuth";
import { UserError } from "@/lib/services/core";

/**
 * Five wrong passwords lock an email for 15 minutes; 25 from one address lock that address.
 * ponytail: an attacker can lock a real person out for 15 minutes by guessing at their email. Accepted: the alternative is unlimited guessing.
 */
export async function login(fd: FormData) {
  await act("/login", async () => {
    const email = str(fd, "email").toLowerCase();
    const ip = clientIp(await headers());
    await throttle("login", email, 5, 15, { resetOnSuccess: true });
    await throttle("login", `ip:${ip}`, 25, 15);
    const user = await checkLogin(email, str(fd, "password"));
    if (!user) {
      await recordAttempt("login", email);
      await recordAttempt("login", `ip:${ip}`);
      // Same message for unknown email and wrong password.
      throw new UserError("That email and password don't match.");
    }
    await recordAttempt("login", email, true);
    await createSession(user.id, user.agency_id);
    return "/app";
  });
}

/** Sign-up is closed: an agency is created only from an emailed invitation. */
export async function signup(fd: FormData) {
  const invite = str(fd, "invite");
  await act(`/signup?invite=${encodeURIComponent(invite)}`, async () => {
    const made = await signupWithInvite(invite, {
      agencyName: str(fd, "agencyName"),
      agencyType: str(fd, "agencyType"),
      ownerName: str(fd, "ownerName"),
      password: str(fd, "password"),
    });
    await createSession(made.userId, made.agencyId);
    return "/app/settings?tab=import&welcome=1";
  });
}

export async function acceptInviteAction(fd: FormData) {
  const token = str(fd, "token");
  await act(`/invite/${encodeURIComponent(token)}`, async () => {
    const made = await acceptStaffInvite(token, str(fd, "password"));
    await createSession(made.userId, made.agencyId);
    return "/app/chat";
  });
}

export async function forgotPasswordAction(fd: FormData) {
  await act("/forgot", async () => {
    await requestPasswordReset(str(fd, "email"), clientIp(await headers()));
    return "/forgot?sent=1";
  });
}

export async function resetPasswordAction(fd: FormData) {
  const token = str(fd, "token");
  await act(`/reset/${encodeURIComponent(token)}`, async () => {
    if (str(fd, "password") !== str(fd, "confirm")) throw new UserError("The two passwords don't match.");
    await resetPassword(token, str(fd, "password"));
    return "/login?ok=" + encodeURIComponent("Password updated. Log in with your new password.");
  });
}

export async function joinWaitlistAction(fd: FormData) {
  await act("/waitlist", async () => {
    // A hidden field real people never fill in: bots do. Pretend it worked.
    if (str(fd, "website")) return "/waitlist?joined=1";
    await joinWaitlist(
      {
        name: str(fd, "name"),
        email: str(fd, "email"),
        agencyName: str(fd, "agencyName"),
        teamSize: Number(str(fd, "teamSize")) || null,
        tools: { time: str(fd, "time"), projects: str(fd, "projects"), accounting: str(fd, "accounting"), email: str(fd, "mail") },
        note: str(fd, "note"),
      },
      clientIp(await headers()),
    );
    return "/waitlist?joined=1";
  });
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

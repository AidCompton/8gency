"use server";
import { act, bool, str } from "@/lib/actions";
import { currentSessionHash, requireUser } from "@/lib/auth";
import { adminQuery } from "@/lib/db";
import { signOutOtherDevices } from "@/lib/services/accountAuth";
import { UserError } from "@/lib/services/core";

export async function updateProfileAction(fd: FormData) {
  const user = await requireUser();
  await act("/app/account", async () => {
    const name = str(fd, "name").replace(/\s+/g, " ").trim();
    if (name.length < 2 || name.length > 80) throw new UserError("Enter your name (2 to 80 characters).");
    await adminQuery("update users set name = $2 where id = $1", [user.id, name]);
  }, "Saved.");
}

export async function signOutOthersAction() {
  const user = await requireUser();
  await act("/app/account?tab=security", async () => {
    await signOutOtherDevices(user.id, user.agency_id, await currentSessionHash());
  }, "Signed out of your other devices.");
}

export async function setEmailPrefsAction(fd: FormData) {
  const user = await requireUser();
  await act("/app/account?tab=notifications", async () => {
    await adminQuery("update users set chat_nudges = $2, timesheet_reminders = $3 where id = $1", [user.id, bool(fd, "chat_nudges"), bool(fd, "timesheet_reminders")]);
    if (user.role === "owner") await adminQuery("update users set weekly_email = $2 where id = $1", [user.id, bool(fd, "weekly_email")]);
  }, "Saved.");
}

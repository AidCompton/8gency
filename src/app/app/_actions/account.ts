"use server";
import { act, bool, str } from "@/lib/actions";
import { currentSessionHash, requireUser } from "@/lib/auth";
import { adminQuery } from "@/lib/db";
import { changePassword, signOutOtherDevices } from "@/lib/services/accountAuth";
import { UserError } from "@/lib/services/core";

export async function changePasswordAction(fd: FormData) {
  const user = await requireUser();
  await act("/app/account", async () => {
    if (str(fd, "next") !== str(fd, "confirm")) throw new UserError("The two new passwords don't match.");
    await changePassword(user.id, user.agency_id, str(fd, "current"), str(fd, "next"), await currentSessionHash());
  }, "Password changed. Your other devices were signed out.");
}

export async function signOutOthersAction() {
  const user = await requireUser();
  await act("/app/account", async () => {
    await signOutOtherDevices(user.id, user.agency_id, await currentSessionHash());
  }, "Signed out of your other devices.");
}

export async function setChatNudgesAction(fd: FormData) {
  const user = await requireUser();
  await act("/app/account", async () => {
    await adminQuery("update users set chat_nudges = $2 where id = $1", [user.id, bool(fd, "chat_nudges")]);
  }, "Saved.");
}

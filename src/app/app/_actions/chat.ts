"use server";
import { act, bool, str } from "@/lib/actions";
import { assertModule, requireUser, tenant } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  addMembers, createChannel, deleteMessage, editMessage, joinChannel, leaveChannel, openDirect, sendMessage, toggleReaction, updateChannel,
} from "@/lib/services/chat";
import { UserError } from "@/lib/services/core";

/** For calls from the chat screen: a readable error instead of a redirect. */
async function attempt(fn: (user: Awaited<ReturnType<typeof requireUser>>) => Promise<unknown>): Promise<{ error?: string }> {
  const user = await requireUser();
  try {
    assertModule(user, "chat");
    await fn(user);
    return {};
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export async function sendChatAction(channelId: string, body: string, kudos: boolean) {
  return attempt((user) => tenant(user, (tx) => sendMessage(tx, channelId, body, kudos ? "kudos" : "message")));
}
export async function reactChatAction(messageId: string, emoji: string) {
  return attempt((user) => tenant(user, (tx) => toggleReaction(tx, messageId, emoji)));
}
export async function editChatAction(messageId: string, body: string) {
  return attempt((user) => tenant(user, (tx) => editMessage(tx, messageId, body)));
}
export async function deleteChatAction(messageId: string) {
  return attempt((user) => tenant(user, (tx) => deleteMessage(tx, messageId, can(user, "settings"))));
}

const ids = (fd: FormData, k: string) => fd.getAll(k).map(String).filter(Boolean);

export async function createChannelAction(fd: FormData) {
  const user = await requireUser();
  assertModule(user, "chat");
  await act("/app/chat/new", () =>
    tenant(user, async (tx) => {
      const id = await createChannel(tx, {
        name: str(fd, "name"),
        topic: str(fd, "topic"),
        emoji: str(fd, "emoji"),
        category: str(fd, "category"),
        private: bool(fd, "private"),
        company_id: str(fd, "company_id") || null,
        members: ids(fd, "members"),
      });
      return `/app/chat/${id}`;
    }),
  );
}

export async function openDirectAction(fd: FormData) {
  const user = await requireUser();
  assertModule(user, "chat");
  await act("/app/chat/new", () => tenant(user, async (tx) => `/app/chat/${await openDirect(tx, ids(fd, "people"))}`));
}

export async function joinChannelAction(fd: FormData) {
  const user = await requireUser();
  assertModule(user, "chat");
  const id = str(fd, "id");
  await act(`/app/chat/${id}`, () => tenant(user, (tx) => joinChannel(tx, id)), "You're in. Say hi 👋");
}

export async function leaveChannelAction(fd: FormData) {
  const user = await requireUser();
  assertModule(user, "chat");
  const id = str(fd, "id");
  await act(`/app/chat/${id}`, async () => {
    await tenant(user, (tx) => leaveChannel(tx, id));
    return "/app/chat";
  }, "You left the group.");
}

export async function updateChannelAction(fd: FormData) {
  const user = await requireUser();
  assertModule(user, "chat");
  const id = str(fd, "id");
  const archive = str(fd, "archive") === "1";
  await act(`/app/chat/${id}`, async () => {
    await tenant(user, (tx) =>
      updateChannel(tx, id, can(user, "settings"), archive ? { archive: true } : {
        name: fd.has("name") ? str(fd, "name") : undefined,
        topic: str(fd, "topic"),
        emoji: str(fd, "emoji"),
        private: fd.has("private_set") ? bool(fd, "private") : undefined,
      }),
    );
    return archive ? "/app/chat" : `/app/chat/${id}`;
  }, archive ? "Group archived." : "Saved.");
}

export async function addMembersAction(fd: FormData) {
  const user = await requireUser();
  assertModule(user, "chat");
  const id = str(fd, "id");
  await act(`/app/chat/${id}`, () => tenant(user, (tx) => addMembers(tx, id, ids(fd, "members"))), "Added.");
}

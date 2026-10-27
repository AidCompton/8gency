import { notFound } from "next/navigation";
import { ChatApp } from "@/components/ChatApp";
import { channelTitle } from "@/lib/domain/chat";
import { getSessionUser, requireUser, tenant, requireModule } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { channelFor, chatPeople, ensureDefaults, markChannelRead, messages, sidebar, touchPresence, unreadMentions } from "@/lib/services/chat";
import { UserError } from "@/lib/services/core";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user || !UUID.test(id)) return { title: "Chat" };
  const c = await tenant(user, (tx) => channelFor(tx, id, user.id)).catch(() => null);
  return { title: c ? `${c.kind === "dm" ? channelTitle(c) : `#${c.name}`} · Chat` : "Chat" };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ChatChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requireUser();
  requireModule(user, "chat");
  const data = await tenant(user, async (tx) => {
    await ensureDefaults(tx);
    let channel;
    try {
      channel = await channelFor(tx, id, user.id);
    } catch (e) {
      if (e instanceof UserError) return null;
      throw e;
    }
    const page = await messages(tx, id, user.id, { limit: 61 });
    const list = page.slice(-60);
    const lastRead = (await tx.one<{ last_read_seq: number }>("select last_read_seq from chat_members where channel_id = $1 and user_id = $2", [id, user.id]))?.last_read_seq ?? 0;
    if (channel.member) await markChannelRead(tx, id, user.id);
    await touchPresence(tx, user.id);
    const people = await chatPeople(tx);
    const memberIds = new Set((await tx.q<{ user_id: string }>("select user_id from chat_members where channel_id = $1", [id])).map((r) => r.user_id));
    return { channel, list, more: page.length > 60, lastRead: Number(lastRead), channels: await sidebar(tx, user.id), mentions: await unreadMentions(tx, user.id), people, members: people.filter((p) => memberIds.has(p.id)) };
  });
  if (!data) notFound();
  return (
    <>
      <ChatApp
        key={id}
        me={user.id}
        isManager={can(user, "settings")}
        channel={data.channel}
        channels={data.channels}
        people={data.people}
        members={data.members}
        initial={data.list}
        lastRead={data.lastRead}
        hasMore={data.more}
        mentions={data.mentions}
      />
    </>
  );
}

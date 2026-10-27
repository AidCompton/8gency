import { getSessionUser, tenant } from "@/lib/auth";
import { modulesOf } from "@/lib/domain/modules";
import { sidebar, touchPresence, unreadMentions } from "@/lib/services/chat";

/** What the chat sidebar needs when no conversation is open: unread counts, mentions and who's online. Polled every few seconds. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "signed out" }, { status: 401 });
  if (!modulesOf(user.modules).chat) return Response.json({ error: "chat is switched off" }, { status: 403 });
  return Response.json(
    await tenant(user, async (tx) => {
      await touchPresence(tx, user.id);
      const side = await sidebar(tx, user.id);
      const online = await tx.q<{ id: string }>("select id from users where active and last_seen_at > now() - interval '5 minutes'");
      return { unread: Object.fromEntries(side.map((c) => [c.id, c.unread])), mentions: await unreadMentions(tx, user.id), online: online.map((o) => o.id) };
    }),
  );
}

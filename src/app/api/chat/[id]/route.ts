import { getSessionUser, tenant } from "@/lib/auth";
import { channelFor, markRead, messages, sidebar, touchPresence } from "@/lib/services/chat";
import { UserError } from "@/lib/services/core";

/**
 * The open conversation polls this every few seconds: new and changed messages
 * since the last poll, unread counts for the sidebar and who's online.
 * ponytail: polling, not websockets; move to SSE + LISTEN/NOTIFY if teams outgrow a few-second delay.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "signed out" }, { status: 401 });
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const after = Number(q.get("after")) || 0;
  const since = q.get("since");
  try {
    return Response.json(
      await tenant(user, async (tx) => {
        await channelFor(tx, id, user.id);
        const now = (await tx.one<{ now: string }>("select now()::text as now"))!.now;
        const list = await messages(tx, id, user.id, { afterSeq: after, since: since && !Number.isNaN(Date.parse(since)) ? since : undefined, limit: 200 });
        const top = list.reduce((s, m) => Math.max(s, m.seq), after);
        if (q.get("read") === "1" && top > 0) await markRead(tx, id, user.id, top);
        await touchPresence(tx, user.id);
        const side = await sidebar(tx, user.id);
        const online = await tx.q<{ id: string }>("select id from users where active and last_seen_at > now() - interval '5 minutes'");
        return { now, messages: list, unread: Object.fromEntries(side.map((c) => [c.id, c.unread])), online: online.map((o) => o.id) };
      }),
    );
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

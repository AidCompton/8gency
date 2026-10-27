import { getSessionUser, tenant } from "@/lib/auth";
import { modulesOf } from "@/lib/domain/modules";
import { channelFor, markChannelRead, messages } from "@/lib/services/chat";
import { UserError } from "@/lib/services/core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The replies in one thread, and anything that changed in them since the last poll. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; mid: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "signed out" }, { status: 401 });
  if (!modulesOf(user.modules).chat) return Response.json({ error: "chat is switched off" }, { status: 403 });
  const { id, mid } = await params;
  if (!UUID.test(id) || !UUID.test(mid)) return Response.json({ error: "not found" }, { status: 404 });
  const q = new URL(req.url).searchParams;
  const since = q.get("since");
  try {
    return Response.json(
      await tenant(user, async (tx) => {
        await channelFor(tx, id, user.id);
        const now = (await tx.one<{ now: string }>("select now()::text as now"))!.now;
        const replies = await messages(tx, id, user.id, { parentId: mid, afterSeq: Number(q.get("after")) || 0, since: since && !Number.isNaN(Date.parse(since)) ? since : undefined, limit: 200 });
        if (q.get("read") === "1") await markChannelRead(tx, id, user.id);
        return { now, replies };
      }),
    );
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

import { getSessionUser, tenant } from "@/lib/auth";
import { channelFor, messages } from "@/lib/services/chat";
import { UserError } from "@/lib/services/core";

/** Older messages, a page at a time, for scrolling back. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "signed out" }, { status: 401 });
  const { id } = await params;
  const before = Number(new URL(req.url).searchParams.get("before")) || 0;
  try {
    return Response.json(
      await tenant(user, async (tx) => {
        await channelFor(tx, id, user.id);
        const page = await messages(tx, id, user.id, { beforeSeq: before, limit: 61 });
        return { messages: page.slice(-60), more: page.length > 60 };
      }),
    );
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

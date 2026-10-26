import { getSessionUser, tenant } from "@/lib/auth";
import { modulesOf } from "@/lib/domain/modules";
import { chatFile } from "@/lib/services/chat";
import { UserError } from "@/lib/services/core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A chat attachment. Pictures show in the page; everything else downloads, and nothing is ever run as a page. */
export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "signed out" }, { status: 401 });
  if (!modulesOf(user.modules).chat) return Response.json({ error: "chat is switched off" }, { status: 403 });
  const { fileId } = await params;
  if (!UUID.test(fileId)) return Response.json({ error: "not found" }, { status: 404 });
  try {
    const f = await tenant(user, (tx) => chatFile(tx, fileId));
    const image = f.mime.startsWith("image/");
    return new Response(new Uint8Array(f.data), {
      headers: {
        "content-type": f.mime,
        "content-length": String(f.size),
        "content-disposition": `${image ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

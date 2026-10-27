import { getSessionUser, tenant } from "@/lib/auth";
import { modulesOf } from "@/lib/domain/modules";
import { idempotent } from "@/lib/idempotency";
import { saveChatFile } from "@/lib/services/chat";
import { UserError } from "@/lib/services/core";

/** One file per request, attached to a message when it's sent. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "signed out" }, { status: 401 });
  if (!modulesOf(user.modules).chat) return Response.json({ error: "chat is switched off" }, { status: 403 });
  const { id } = await params;
  const file = (await req.formData().catch(() => null))?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a file to attach." }, { status: 400 });
  try {
    // The browser sends one Idempotency-Key per file and reuses it when it retries, so a flaky connection never stores the file twice.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = await idempotent(req.headers.get("idempotency-key"), `upload:${user.id}`, () => tenant(user, (tx) => saveChatFile(tx, id, { name: file.name, bytes })));
    if (r.status === "busy") return Response.json({ error: "That file is still uploading." }, { status: 409 });
    return Response.json(r.value);
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

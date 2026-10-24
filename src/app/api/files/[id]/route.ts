import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { getSessionUser, tenant } from "@/lib/auth";
import { asContact, resolveHubToken } from "@/lib/services/hub";
import { UPLOAD_ROOT } from "@/lib/services/review";

// Serves proofing files to staff (session) or to a client contact (hub token),
// always through the tenant-scoped connection.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const hub = new URL(req.url).searchParams.get("hub");
  type V = { file_path: string; file_name: string; mime: string; company_id: string };
  const sql = `select v.file_path, v.file_name, v.mime, j.company_id from versions v join deliverables d on d.id = v.deliverable_id join jobs j on j.id = d.job_id where v.id = $1`;
  let v: V | null = null;
  if (hub) {
    const contact = await resolveHubToken(hub);
    if (!contact) return new Response("Link expired", { status: 403 });
    v = await asContact(contact, (tx) => tx.one<V>(sql, [id]));
    if (v && v.company_id !== contact.company_id) v = null;
  } else {
    const user = await getSessionUser();
    if (!user) return new Response("Unauthorised", { status: 401 });
    v = await tenant(user, (tx) => tx.one<V>(sql, [id]));
  }
  if (!v) return new Response("Not found", { status: 404 });
  const abs = resolve(join(UPLOAD_ROOT, v.file_path));
  if (!abs.startsWith(UPLOAD_ROOT + sep)) return new Response("Not found", { status: 404 });
  try {
    const body = await readFile(abs);
    const inline = /^(image|video|audio)\/|application\/pdf/.test(v.mime);
    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": v.mime,
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${v.file_name.replace(/"/g, "")}"`,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
        // SVGs can carry script; render them sandboxed.
        "content-security-policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch {
    return new Response("File missing", { status: 410 });
  }
}

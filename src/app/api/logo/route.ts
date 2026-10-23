import { getSessionUser, tenant } from "@/lib/auth";
import type { Tx } from "@/lib/db";
import { asContact, resolveHubToken } from "@/lib/services/hub";

// The agency logo, for staff (session) or a client contact (hub token), read
// through the tenant-scoped connection. Pages add ?v=<logo_updated_at> so the
// long cache is safe.
export async function GET(req: Request) {
  const hub = new URL(req.url).searchParams.get("hub");
  const read = (tx: Tx) => tx.one<{ logo: Buffer | null; logo_mime: string }>("select logo, logo_mime from agencies where id = $1", [tx.agencyId]);
  let row: { logo: Buffer | null; logo_mime: string } | null;
  if (hub) {
    const contact = await resolveHubToken(hub);
    if (!contact) return new Response("Link expired", { status: 403 });
    row = await asContact(contact, read);
  } else {
    const user = await getSessionUser();
    if (!user) return new Response("Unauthorised", { status: 401 });
    row = await tenant(user, read);
  }
  if (!row?.logo) return new Response("No logo", { status: 404 });
  return new Response(new Uint8Array(row.logo), {
    headers: {
      "content-type": row.logo_mime,
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      // SVGs can carry script; render them sandboxed.
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}

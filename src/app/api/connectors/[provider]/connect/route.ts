import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { authorizeUrl } from "@/lib/connectors/connections";
import { missingEnv, provider } from "@/lib/connectors/providers";
import { can } from "@/lib/permissions";
import { sign } from "@/lib/vault";

/** Start sign-in with a provider. The state is signed and bound to this browser by a cookie. */
export async function GET(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: key } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const p = provider(key);
  if (!p || p.auth.kind !== "oauth") return new Response("Unknown connector", { status: 404 });
  const back = `/app/connectors/${p.catalog}`;
  if (!p.personal && !can(user, "settings")) redirect(`${back}?error=${encodeURIComponent("Only owners and operations can connect agency-wide apps.")}`);
  const missing = missingEnv(p);
  if (missing.length) redirect(`${back}?error=${encodeURIComponent(`${p.name} isn't set up on this server yet (missing ${missing.join(", ")}).`)}`);
  const nonce = randomBytes(16).toString("base64url");
  (await cookies()).set("8g_oauth", nonce, { httpOnly: true, sameSite: "lax", secure: process.env.APP_URL?.startsWith("https") ?? false, maxAge: 600, path: "/api/connectors" });
  redirect(authorizeUrl(p, sign({ a: user.agency_id, u: user.id, p: p.key, n: nonce })));
}

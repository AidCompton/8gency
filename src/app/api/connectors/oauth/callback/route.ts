import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, tenant } from "@/lib/auth";
import { exchangeCode, saveConnection } from "@/lib/connectors/connections";
import { identify } from "@/lib/connectors/identify";
import { provider, type ProviderKey } from "@/lib/connectors/providers";
import { can } from "@/lib/permissions";
import { safeEqual, verify } from "@/lib/vault";

/** Every OAuth app redirects here; the signed state says which provider and agency. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const state = verify<{ a: string; u: string; p: ProviderKey; n: string }>(q.get("state") ?? "");
  const jar = await cookies();
  const nonce = jar.get("8g_oauth")?.value ?? "";
  jar.delete({ name: "8g_oauth", path: "/api/connectors" });
  const user = await getSessionUser();
  const p = state && provider(state.p);
  if (!state || !p || !user || user.id !== state.u || user.agency_id !== state.a || !safeEqual(nonce, state.n)) {
    redirect(`/app/connectors?error=${encodeURIComponent("That sign-in link expired or wasn't started here. Try connecting again.")}`);
  }
  const back = `/app/connectors/${p.catalog}`;
  if (!p.personal && !can(user, "settings")) redirect(`${back}?error=${encodeURIComponent("Only owners and operations can connect agency-wide apps.")}`);
  if (q.get("error")) redirect(`${back}?error=${encodeURIComponent(`${p.name} sign-in was cancelled.`)}`);
  let message: string;
  try {
    const tokens = await exchangeCode(p, q.get("code") ?? "");
    const who = await identify(p.key, tokens, q);
    const secret = { ...tokens, ...who.secret };
    await tenant(user, (tx) =>
      saveConnection(tx, {
        provider: p.key,
        userId: p.personal ? user.id : null,
        label: who.label,
        externalId: who.externalId,
        scopes: typeof tokens.scope === "string" ? tokens.scope.split(/[ ,]+/) : [],
        secret,
        expiresIn: who.expiresIn !== undefined ? who.expiresIn : (tokens.expires_in ?? null),
      }),
    );
    message = `ok=${encodeURIComponent(`${p.name} connected as ${who.label}.`)}`;
  } catch (e) {
    console.error(`connect ${p.key} failed`, e);
    message = `error=${encodeURIComponent((e as Error).message || `Couldn't connect ${p.name}.`)}`;
  }
  redirect(`${back}?${message}`);
}

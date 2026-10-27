import { ConnectorError, type Secret } from "./connections";
import type { ProviderKey } from "./providers";
import { GRAPH } from "./versions";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function get(url: string, token: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...init.headers } });
  if (!res.ok) throw new ConnectorError(`Couldn't read the connected account (${res.status}).`);
  return res.json();
}

/**
 * After sign-in: which account was connected (shown on the card) and its id
 * at the provider. Some providers also swap the token here (Meta long-lived).
 */
export async function identify(
  key: ProviderKey,
  tokens: Secret & { expires_in?: number },
  query: URLSearchParams,
): Promise<{ label: string; externalId: string; secret?: Secret; expiresIn?: number | null }> {
  const t = tokens.access_token ?? "";
  switch (key) {
    case "gmail":
    case "google_calendar":
    case "google_drive":
    case "ga4":
    case "google_ads": {
      const me = await get("https://openidconnect.googleapis.com/v1/userinfo", t);
      return { label: me.email, externalId: me.sub };
    }
    case "outlook": {
      const me = await get("https://graph.microsoft.com/v1.0/me", t);
      return { label: me.mail ?? me.userPrincipalName, externalId: me.id };
    }
    case "slack":
      return { label: tokens.team?.name ?? "Slack", externalId: tokens.team?.id ?? "" };
    case "xero": {
      const tenants = (await get("https://api.xero.com/connections", t)) as { tenantId: string; tenantName: string; authEventId: string }[];
      // The organisation just authorised carries this sign-in's event id (a claim in the access token).
      const claims = JSON.parse(Buffer.from(t.split(".")[1] ?? "", "base64url").toString("utf8") || "{}");
      const mine = tenants.find((x) => x.authEventId === claims.authentication_event_id) ?? tenants[0];
      if (!mine) throw new ConnectorError("No Xero organisation was shared with 8gency.");
      return { label: mine.tenantName, externalId: mine.tenantId };
    }
    case "quickbooks": {
      const realm = query.get("realmId") ?? "";
      const info = await get(`${qboBase()}/v3/company/${realm}/companyinfo/${realm}`, t).catch(() => null);
      return { label: info?.CompanyInfo?.CompanyName ?? `Company ${realm}`, externalId: realm };
    }
    case "meta_ads": {
      // Swap the short-lived token for a 60-day one; Meta has no refresh tokens.
      const v = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: process.env.META_CLIENT_ID ?? "", client_secret: process.env.META_CLIENT_SECRET ?? "", fb_exchange_token: t });
      const long = await get(`https://graph.facebook.com/${GRAPH}/oauth/access_token?${v}`, t);
      const me = await get(`https://graph.facebook.com/${GRAPH}/me?fields=name`, long.access_token);
      return { label: me.name, externalId: me.id, secret: { access_token: long.access_token }, expiresIn: long.expires_in ?? 60 * 86400 };
    }
    case "hubspot": {
      const info = await get(`https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(t)}`, t);
      return { label: info.hub_domain ?? `Hub ${info.hub_id}`, externalId: String(info.hub_id ?? "") };
    }
    case "dropbox": {
      const me = await get("https://api.dropboxapi.com/2/users/get_current_account", t, { method: "POST" });
      return { label: me.email, externalId: me.account_id };
    }
    case "figma": {
      const me = await get("https://api.figma.com/v1/me", t);
      return { label: me.email ?? me.handle, externalId: me.id };
    }
    case "zoom": {
      const me = await get("https://api.zoom.us/v2/users/me", t);
      return { label: me.email, externalId: me.id };
    }
    default:
      throw new ConnectorError(`${key} doesn't use sign-in.`);
  }
}

export const qboBase = () => (process.env.QUICKBOOKS_ENV === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com");

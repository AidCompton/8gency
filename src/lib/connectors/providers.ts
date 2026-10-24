// Every app 8gency can connect to: how it signs in (OAuth or pasted keys),
// whether it's agency-wide or personal, and which catalogue card it belongs to.
// Adapters that call each API live next to this file.
import { GRAPH } from "./versions";

export type ProviderKey =
  | "gmail" | "google_calendar" | "google_drive" | "ga4" | "google_ads" | "outlook" | "slack" | "whatsapp"
  | "xero" | "quickbooks" | "meta_ads" | "hubspot" | "dropbox" | "figma" | "zoom" | "stripe" | "paystack" | "payfast";

export interface OAuthDef {
  kind: "oauth";
  /** Prefix of the <APP>_CLIENT_ID / <APP>_CLIENT_SECRET environment variables. */
  app: "GOOGLE" | "MICROSOFT" | "SLACK" | "XERO" | "QUICKBOOKS" | "META" | "HUBSPOT" | "DROPBOX" | "FIGMA" | "ZOOM";
  authUrl: string;
  tokenUrl: string;
  /** Where refresh_token grants go, when not the token URL. */
  refreshUrl?: string;
  scopes: string[];
  scopeParam?: string;
  scopeSep?: string;
  params?: Record<string, string>;
  /** How the client secret is sent to the token endpoint. */
  clientAuth: "body" | "basic";
}

export interface KeyField {
  key: string;
  label: string;
  secret?: boolean;
  hint?: string;
  checkbox?: boolean;
}

export interface ApiKeyDef {
  kind: "apikey";
  fields: KeyField[];
}

export interface ProviderDef {
  key: ProviderKey;
  name: string;
  /** Card in the connectors catalogue (src/lib/domain/connectors.ts). */
  catalog: string;
  /** Personal connections belong to one person (their calendar); the rest are agency-wide. */
  personal: boolean;
  auth: OAuthDef | ApiKeyDef;
  /** Has an incoming webhook the agency must register with the provider. */
  webhook?: boolean;
  /** Extra environment variables the provider needs besides the OAuth app. */
  env?: string[];
  /** What a person connecting it should know. */
  note?: string;
}

const GOOGLE = {
  kind: "oauth", app: "GOOGLE", clientAuth: "body",
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  params: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
} as const;
const google = (scopes: string[]): OAuthDef => ({ ...GOOGLE, scopes: ["openid", "email", ...scopes.map((s) => `https://www.googleapis.com/auth/${s}`)] });

export const PROVIDERS: ProviderDef[] = [
  { key: "gmail", name: "Gmail", catalog: "gmail", personal: false, auth: google(["gmail.send"]), note: "Client emails from the Outbox and automations are sent from this mailbox." },
  { key: "google_calendar", name: "Google Calendar", catalog: "google_calendar", personal: true, auth: google(["calendar.events"]), note: "Your client meetings (including Google Meet calls) become timesheet suggestions. Only you see them." },
  { key: "google_drive", name: "Google Drive", catalog: "google_drive", personal: false, auth: google(["drive"]), note: "Add proof versions from a Drive link, and file approved finals in each client's folder." },
  { key: "ga4", name: "Google Analytics 4", catalog: "ga4", personal: false, auth: google(["analytics.readonly"]), note: "Weekly results per client in status reports." },
  { key: "google_ads", name: "Google Ads", catalog: "google_ads", personal: false, auth: google(["adwords"]), env: ["GOOGLE_ADS_DEVELOPER_TOKEN"], note: "Daily spend becomes re-billable costs on the mapped job." },
  {
    key: "outlook", name: "Microsoft 365", catalog: "outlook", personal: true,
    auth: {
      kind: "oauth", app: "MICROSOFT", clientAuth: "body",
      authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      scopes: ["offline_access", "User.Read", "Mail.Send", "Calendars.Read"],
    },
    note: "Your Outlook meetings become timesheet suggestions. Owners can also send the Outbox through this mailbox.",
  },
  {
    key: "slack", name: "Slack", catalog: "slack", personal: false,
    auth: {
      kind: "oauth", app: "SLACK", clientAuth: "body", scopeSep: ",",
      authUrl: "https://slack.com/oauth/v2/authorize",
      tokenUrl: "https://slack.com/api/oauth.v2.access",
      scopes: ["chat:write", "chat:write.public", "channels:read", "groups:read"],
    },
    note: "Post automation messages to a channel per client.",
  },
  {
    key: "whatsapp", name: "WhatsApp Business", catalog: "whatsapp", personal: false, webhook: true,
    auth: {
      kind: "apikey",
      fields: [
        { key: "phone_number_id", label: "Phone number ID", hint: "Meta Business › WhatsApp Manager › API setup" },
        { key: "access_token", label: "Permanent access token", secret: true, hint: "A system user token with whatsapp_business_messaging" },
        { key: "app_secret", label: "App secret", secret: true, hint: "Used to check incoming webhooks really come from Meta" },
        { key: "template", label: "Fallback template name (optional)", hint: "An approved template with one body variable, used outside the 24-hour reply window" },
      ],
    },
    note: "Delivers the Outbox's WhatsApp messages and reads replies (APPROVE / CHANGES).",
  },
  {
    key: "xero", name: "Xero", catalog: "xero", personal: false,
    auth: {
      kind: "oauth", app: "XERO", clientAuth: "basic",
      authUrl: "https://login.xero.com/identity/connect/authorize",
      tokenUrl: "https://identity.xero.com/connect/token",
      scopes: ["openid", "profile", "email", "offline_access", "accounting.transactions", "accounting.contacts"],
    },
    note: "Issued invoices are created in Xero; payments recorded there mark them paid here.",
  },
  {
    key: "quickbooks", name: "QuickBooks Online", catalog: "quickbooks", personal: false,
    auth: {
      kind: "oauth", app: "QUICKBOOKS", clientAuth: "basic",
      authUrl: "https://appcenter.intuit.com/connect/oauth2",
      tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      scopes: ["com.intuit.quickbooks.accounting"],
    },
    note: "Issued invoices are created in QuickBooks; payments there mark them paid here.",
  },
  {
    key: "meta_ads", name: "Meta Ads", catalog: "meta_ads", personal: false,
    auth: {
      kind: "oauth", app: "META", clientAuth: "body", scopeSep: ",",
      authUrl: `https://www.facebook.com/${GRAPH}/dialog/oauth`,
      tokenUrl: `https://graph.facebook.com/${GRAPH}/oauth/access_token`,
      scopes: ["ads_read"],
    },
    note: "Daily spend per ad account becomes re-billable costs on the mapped job.",
  },
  {
    key: "hubspot", name: "HubSpot", catalog: "hubspot", personal: false,
    auth: {
      kind: "oauth", app: "HUBSPOT", clientAuth: "body",
      authUrl: "https://app.hubspot.com/oauth/authorize",
      tokenUrl: "https://api.hubapi.com/oauth/v1/token",
      scopes: ["oauth", "crm.objects.deals.read", "crm.objects.companies.read", "crm.objects.contacts.read"],
    },
    note: "Closed-won deals become a client and a job automatically.",
  },
  {
    key: "dropbox", name: "Dropbox", catalog: "dropbox", personal: false,
    auth: {
      kind: "oauth", app: "DROPBOX", clientAuth: "body",
      authUrl: "https://www.dropbox.com/oauth2/authorize",
      tokenUrl: "https://api.dropboxapi.com/oauth2/token",
      scopes: ["account_info.read", "files.content.read", "files.content.write", "sharing.read"],
      params: { token_access_type: "offline" },
    },
    note: "Add proof versions from a Dropbox link, and file approved finals in each client's folder.",
  },
  {
    key: "figma", name: "Figma", catalog: "figma", personal: false,
    auth: {
      kind: "oauth", app: "FIGMA", clientAuth: "basic",
      authUrl: "https://www.figma.com/oauth",
      tokenUrl: "https://api.figma.com/v1/oauth/token",
      refreshUrl: "https://api.figma.com/v1/oauth/refresh",
      scopes: ["current_user:read", "file_content:read"],
    },
    note: "Send a Figma frame for client review: paste its link as a new version.",
  },
  {
    key: "zoom", name: "Zoom", catalog: "zoom", personal: true,
    auth: {
      kind: "oauth", app: "ZOOM", clientAuth: "basic",
      authUrl: "https://zoom.us/oauth/authorize",
      tokenUrl: "https://zoom.us/oauth/token",
      scopes: ["user:read:user", "meeting:read:list_meetings", "meeting:read:past_meeting"],
    },
    note: "Your Zoom meetings become timesheet suggestions. Google Meet calls come through Google Calendar.",
  },
  {
    key: "payfast", name: "PayFast", catalog: "payments", personal: false, webhook: true,
    auth: {
      kind: "apikey",
      fields: [
        { key: "merchant_id", label: "Merchant ID" },
        { key: "merchant_key", label: "Merchant key", secret: true },
        { key: "passphrase", label: "Passphrase", secret: true, hint: "Set under Settings › Developer settings in PayFast" },
        { key: "sandbox", label: "Sandbox (testing)", checkbox: true },
      ],
    },
    note: "Card and instant EFT payments from the client hub.",
  },
  {
    key: "paystack", name: "Paystack", catalog: "payments", personal: false, webhook: true,
    auth: { kind: "apikey", fields: [{ key: "secret_key", label: "Secret key", secret: true, hint: "sk_live_… or sk_test_…" }] },
    note: "Card and instant EFT payments from the client hub.",
  },
  {
    key: "stripe", name: "Stripe", catalog: "payments", personal: false, webhook: true,
    auth: { kind: "apikey", fields: [{ key: "secret_key", label: "Secret key", secret: true, hint: "sk_live_… or sk_test_…" }, { key: "webhook_secret", label: "Webhook signing secret", secret: true, hint: "whsec_… from the webhook endpoint below" }] },
    note: "Card payments from the client hub.",
  },
];

export const provider = (key: string) => PROVIDERS.find((p) => p.key === key);

/** Missing environment variables that stop a provider from being connected on this server. */
export function missingEnv(p: ProviderDef): string[] {
  const need = [...(p.auth.kind === "oauth" ? [`${p.auth.app}_CLIENT_ID`, `${p.auth.app}_CLIENT_SECRET`] : []), ...(p.env ?? [])];
  return need.filter((k) => !process.env[k]);
}

export const oauthRedirectUri = () => `${process.env.APP_URL ?? "http://localhost:3000"}/api/connectors/oauth/callback`;

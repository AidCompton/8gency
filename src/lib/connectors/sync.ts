import { withTenant, type Tx } from "../db";
import { syncQuickBooks, syncXero } from "./accounting";
import { syncGa4, syncGoogleAds, syncMetaAds } from "./ads";
import { accessToken, markNeedsReauth, ReauthError, type Conn } from "./connections";
import { deliverOutbox } from "./delivery";
import { fileFinals } from "./files";
import { syncHubspot } from "./hubspot";
import { syncToggl } from "./toggl";
import { syncTrello } from "./trello";
import { syncGoogleCalendar, syncOutlookCalendar, syncZoom } from "./meetings";
import { provider, type ProviderKey } from "./providers";

// The connector worker, run by the scheduler (/api/cron) or "Sync now".
// Each connection syncs in its own transaction: one app being down never
// blocks the others, and repeated failures back off up to six hours.

const SYNC: Partial<Record<ProviderKey, (tx: Tx, conn: Conn) => Promise<string>>> = {
  google_calendar: syncGoogleCalendar,
  outlook: syncOutlookCalendar,
  zoom: syncZoom,
  xero: syncXero,
  quickbooks: syncQuickBooks,
  meta_ads: syncMetaAds,
  google_ads: syncGoogleAds,
  ga4: syncGa4,
  hubspot: syncHubspot,
  google_drive: fileFinals,
  dropbox: fileFinals,
  toggl: syncToggl,
  trello: syncTrello,
};

export const hasSync = (p: string) => p in SYNC;

/** Most connectors sync every 15 minutes. Toggl and Trello are pulled once a day ("Sync now" does it on demand): they only need to be current for the weekly comparison. */
const EVERY_MINUTES: Partial<Record<ProviderKey, number>> & { default: number } = { default: 15, toggl: 1440, trello: 1440 };

export async function syncConnection(agencyId: string, connId: string): Promise<{ ok: boolean; summary: string }> {
  const ctx = { agencyId, actorLabel: "connector sync" };
  const conn = await withTenant(ctx, (tx) => tx.one<Conn>("select * from connections where id = $1 and status = 'active'", [connId]));
  const run = conn && SYNC[conn.provider];
  if (!conn || !run) return { ok: false, summary: "Nothing to sync." };
  try {
    // Refresh a sign-in token in its own transaction, so a rotated refresh token is never rolled back. API-key connectors have nothing to refresh.
    if (provider(conn.provider)?.auth.kind === "oauth") await withTenant(ctx, (tx) => accessToken(tx, conn));
    const summary = await withTenant(ctx, async (tx) => {
      const s = await run(tx, conn);
      await tx.q(
        "update connections set last_sync_at = now(), failures = 0, last_error = null, next_sync_at = now() + make_interval(mins => $2), settings = settings || jsonb_build_object('last_summary', $3::text) where id = $1",
        [connId, EVERY_MINUTES[conn.provider] ?? EVERY_MINUTES.default, s],
      );
      return s;
    });
    return { ok: true, summary };
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    await withTenant(ctx, async (tx) => {
      if (e instanceof ReauthError) await markNeedsReauth(tx, e.conn, e.message);
      await tx.q("update connections set failures = failures + 1, last_error = $2, next_sync_at = now() + make_interval(mins => least(360, 5 * power(2, failures))::int) where id = $1", [connId, message]);
    });
    console.error(`connector sync ${conn.provider} failed`, e);
    return { ok: false, summary: message };
  }
}

/** Sync every connection that's due, then deliver the Outbox. */
export async function runConnectors(agencyId: string) {
  const due = await withTenant({ agencyId }, (tx) =>
    tx.q<{ id: string; provider: string }>("select id, provider from connections where status = 'active' and next_sync_at <= now() order by next_sync_at"),
  );
  let synced = 0;
  for (const c of due) if (hasSync(c.provider) && (await syncConnection(agencyId, c.id)).ok) synced++;
  const delivered = await deliverOutbox(agencyId);
  return { synced, delivered };
}

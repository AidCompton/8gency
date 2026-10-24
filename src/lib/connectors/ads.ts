import type { Tx } from "../db";
import { startOfMonth, todayIn } from "../domain/dates";
import { formatMoney } from "../domain/money";
import { agencySettings, notify } from "../services/core";
import { api, ConnectorError, upsertObject, type Conn } from "./connections";
import { GOOGLE_ADS, GRAPH } from "./versions";

// Media spend per ad account → re-billable costs on the mapped job, one cost
// per day (re-synced for a week while the platforms settle their numbers),
// plus pacing alerts and weekly results for client status reports.

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Mapping {
  id: string;
  external_id: string;
  external_label: string;
  company_id: string | null;
  job_id: string | null;
  settings: { markup?: number; monthly_budget?: number };
}
interface Day {
  date: string;
  spend_cents: number;
  clicks: number;
  impressions: number;
  conversions: number;
  currency: string;
}

const mappings = (tx: Tx, conn: Conn) => tx.q<Mapping>("select id, external_id, external_label, company_id, job_id, settings from connection_mappings where connection_id = $1", [conn.id]);

const PLATFORM: Record<string, string> = { meta_ads: "Meta Ads", google_ads: "Google Ads" };

/** Store each day's spend and keep one cost line per day on the job, unless it's already been invoiced. */
async function recordSpend(tx: Tx, conn: Conn, m: Mapping, days: Day[]) {
  if (!m.job_id) return 0;
  const job = await tx.one<{ currency: string; status: string }>("select co.currency, j.status from jobs j join companies co on co.id = j.company_id where j.id = $1", [m.job_id]);
  if (!job) return 0;
  let n = 0;
  for (const d of days) {
    if (d.currency && d.currency !== job.currency) throw new ConnectorError(`${m.external_label} spends in ${d.currency} but the client is billed in ${job.currency}. Map it to a ${d.currency} client.`);
    const o = await upsertObject(tx, conn, { kind: "ad_spend", externalId: `${m.external_id}:${d.date}`, on: d.date, payload: { ...d, mapping_id: m.id, account: m.external_label } });
    const desc = `${PLATFORM[conn.provider]} spend ${d.date} · ${m.external_label}`;
    if (o.matched_id) {
      await tx.q("update costs set amount_cents = $2 where id = $1 and invoice_line_id is null", [o.matched_id, d.spend_cents]);
    } else if (d.spend_cents > 0 && job.status !== "closed") {
      // After a reconnect the synced rows are gone but the costs stay: pick the existing line up again.
      const existing = await tx.one<{ id: string }>("select id from costs where job_id = $1 and source = $2 and incurred_on = $3 and description = $4", [m.job_id, conn.provider, d.date, desc]);
      const c =
        existing ??
        (await tx.one<{ id: string }>(
          `insert into costs (agency_id, job_id, supplier, description, amount_cents, incurred_on, rebillable, markup, source)
           values ($1,$2,$3,$4,$5,$6,true,$7,$8) returning id`,
          [tx.agencyId, m.job_id, PLATFORM[conn.provider], desc, d.spend_cents, d.date, m.settings.markup ?? 0, conn.provider],
        ));
      if (existing) await tx.q("update costs set amount_cents = $2 where id = $1 and invoice_line_id is null", [existing.id, d.spend_cents]);
      else n++;
      await tx.q("update external_objects set matched_type = 'cost', matched_id = $2 where id = $1", [o.id, c!.id]);
    }
  }
  return n;
}

/** Tell the account manager and job owner when an account passes 90% and 100% of its monthly budget. */
async function pacing(tx: Tx, conn: Conn, m: Mapping, today: string) {
  const budget = Math.round((m.settings.monthly_budget ?? 0) * 100);
  if (!budget || !m.job_id) return;
  const month = startOfMonth(today);
  const spent = (await tx.one<{ v: number }>(
    "select coalesce(sum((payload->>'spend_cents')::bigint), 0)::bigint as v from external_objects where connection_id = $1 and kind = 'ad_spend' and payload->>'mapping_id' = $2 and occurred_on >= $3",
    [conn.id, m.id, month],
  ))!.v;
  const level = spent >= budget ? 100 : spent >= budget * 0.9 ? 90 : 0;
  if (!level) return;
  const j = await tx.one<{ owner_id: string | null; am: string | null; currency: string; label: string }>(
    `select j.owner_id, coalesce(j.account_manager_id, co.account_manager_id) as am, co.currency, j.number || ' ' || j.name as label
       from jobs j join companies co on co.id = j.company_id where j.id = $1`,
    [m.job_id],
  );
  await notify(tx, [j?.owner_id, j?.am], {
    kind: "connector",
    title: `${m.external_label} ${level === 100 ? "is over" : "is at 90% of"} its monthly budget`,
    body: `${formatMoney(spent, j?.currency ?? "ZAR")} of ${formatMoney(budget, j?.currency ?? "ZAR")} spent this month on ${j?.label}`,
    href: `/app/jobs/${m.job_id}?tab=money`,
    dedupe: `adbudget:${m.id}:${month}:${level}`,
  });
}

async function syncSpend(tx: Tx, conn: Conn, fetchDays: (m: Mapping) => Promise<Day[]>) {
  const today = todayIn((await agencySettings(tx)).timezone);
  let accounts = 0;
  let costs = 0;
  for (const m of await mappings(tx, conn)) {
    if (!m.job_id) continue;
    costs += await recordSpend(tx, conn, m, await fetchDays(m));
    await pacing(tx, conn, m, today);
    accounts++;
  }
  return `${accounts} ad accounts synced, ${costs} new cost lines`;
}

// ── Meta ────────────────────────────────────────────────────────────────

export async function metaAdAccounts(tx: Tx, conn: Conn) {
  const r = await api(tx, conn, `https://graph.facebook.com/${GRAPH}/me/adaccounts?fields=name,account_id,currency&limit=200`);
  return (r.data ?? []).map((a: any) => ({ id: a.id as string, label: `${a.name} (${a.currency})` }));
}

const CONVERSIONS = new Set(["lead", "purchase", "complete_registration"]);

export const syncMetaAds = (tx: Tx, conn: Conn) =>
  syncSpend(tx, conn, async (m) => {
    const q = new URLSearchParams({ fields: "spend,impressions,clicks,actions,account_currency", time_increment: "1", date_preset: "last_7d", limit: "100" });
    const r = await api(tx, conn, `https://graph.facebook.com/${GRAPH}/${m.external_id}/insights?${q}`);
    return (r.data ?? []).map((d: any) => ({
      date: d.date_start,
      spend_cents: Math.round(Number(d.spend ?? 0) * 100),
      clicks: Number(d.clicks ?? 0),
      impressions: Number(d.impressions ?? 0),
      conversions: (d.actions ?? []).filter((a: any) => CONVERSIONS.has(a.action_type)).reduce((s: number, a: any) => s + Number(a.value), 0),
      currency: d.account_currency ?? "",
    }));
  });

// ── Google Ads ──────────────────────────────────────────────────────────

function adsHeaders(conn: Conn) {
  const login = String(conn.settings.login_customer_id ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "").replace(/\D/g, "");
  return { "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "", ...(login ? { "login-customer-id": login } : {}) };
}
const adsSearch = (tx: Tx, conn: Conn, customer: string, query: string) =>
  api(tx, conn, `https://googleads.googleapis.com/${GOOGLE_ADS}/customers/${customer}/googleAds:search`, { method: "POST", headers: adsHeaders(conn), json: { query } });

export async function googleAdsAccounts(tx: Tx, conn: Conn) {
  const r = await api(tx, conn, `https://googleads.googleapis.com/${GOOGLE_ADS}/customers:listAccessibleCustomers`, { headers: adsHeaders(conn) });
  const ids: string[] = (r.resourceNames ?? []).map((n: string) => n.split("/")[1]).slice(0, 25);
  return Promise.all(
    ids.map(async (id) => {
      const c = await adsSearch(tx, conn, id, "SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1").catch(() => null);
      const x = c?.results?.[0]?.customer;
      return { id, label: x ? `${x.descriptiveName} (${x.currencyCode})` : `Account ${id}` };
    }),
  );
}

export const syncGoogleAds = (tx: Tx, conn: Conn) =>
  syncSpend(tx, conn, async (m) => {
    const r = await adsSearch(tx, conn, m.external_id, "SELECT segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, customer.currency_code FROM customer WHERE segments.date DURING LAST_7_DAYS");
    return (r.results ?? []).map((x: any) => ({
      date: x.segments.date,
      spend_cents: Math.round(Number(x.metrics.costMicros ?? 0) / 10_000),
      clicks: Number(x.metrics.clicks ?? 0),
      impressions: Number(x.metrics.impressions ?? 0),
      conversions: Number(x.metrics.conversions ?? 0),
      currency: x.customer?.currencyCode ?? "",
    }));
  });

// ── Google Analytics 4 ──────────────────────────────────────────────────

export async function ga4Properties(tx: Tx, conn: Conn) {
  const r = await api(tx, conn, "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200");
  return (r.accountSummaries ?? []).flatMap((a: any) => (a.propertySummaries ?? []).map((p: any) => ({ id: p.property as string, label: `${p.displayName} · ${a.displayName}` })));
}

export async function syncGa4(tx: Tx, conn: Conn) {
  const today = todayIn((await agencySettings(tx)).timezone);
  let n = 0;
  for (const m of await mappings(tx, conn)) {
    if (!m.company_id) continue;
    const r = await api(tx, conn, `https://analyticsdata.googleapis.com/v1beta/${m.external_id}:runReport`, {
      method: "POST",
      json: {
        dateRanges: [{ startDate: "7daysAgo", endDate: "yesterday", name: "this" }, { startDate: "14daysAgo", endDate: "8daysAgo", name: "prev" }],
        metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "keyEvents" }],
      },
    });
    const pick = (name: string) => {
      const row = (r.rows ?? []).find((x: any) => x.dimensionValues?.[0]?.value === name);
      const v = (i: number) => Number(row?.metricValues?.[i]?.value ?? 0);
      return { users: v(0), sessions: v(1), key_events: v(2) };
    };
    await upsertObject(tx, conn, { kind: "ga4_week", externalId: `${m.external_id}:${today}`, on: today, payload: { property: m.external_label, ...pick("this"), prev: pick("prev") }, matchedType: "company", matchedId: m.company_id });
    n++;
  }
  return `${n} properties read`;
}

/** Last week's marketing results for a client, from what the sync stored. Used in status reports. */
export async function clientResults(tx: Tx, companyId: string, today: string) {
  const ads = await tx.q<{ platform: string; spend: number; clicks: number; conversions: number; currency: string }>(
    `select c.provider as platform, sum((o.payload->>'spend_cents')::bigint)::bigint as spend, sum((o.payload->>'clicks')::numeric)::int as clicks,
            sum((o.payload->>'conversions')::numeric)::float as conversions, max(o.payload->>'currency') as currency
       from external_objects o join connections c on c.id = o.connection_id
       join connection_mappings m on m.id::text = o.payload->>'mapping_id' and m.company_id = $1
      where o.kind = 'ad_spend' and o.occurred_on > ($2::date - 7) group by 1`,
    [companyId, today],
  );
  const web = await tx.one<{ payload: { property: string; users: number; sessions: number; key_events: number; prev: { users: number; sessions: number; key_events: number } } }>(
    "select payload from external_objects where kind = 'ga4_week' and matched_type = 'company' and matched_id = $1 and occurred_on > ($2::date - 8) order by occurred_on desc limit 1",
    [companyId, today],
  );
  return { ads: ads.map((a) => ({ ...a, platform: PLATFORM[a.platform] ?? a.platform })), web: web?.payload ?? null };
}

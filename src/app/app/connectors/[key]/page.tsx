import { ArrowsClockwise, CheckCircle, Plugs, ShieldCheck, Trash, WarningCircle } from "@phosphor-icons/react/ssr";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ConnectorIcon } from "@/components/ConnectorIcon";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, Card, Empty, Field, PageHeader, Table, Td, buttonClass } from "@/components/ui";
import {
  deleteMappingAction, disconnectAction, saveConnectorSettingsAction, saveKeysAction, saveMappingAction, syncNowAction, toggleConnectorRequestAction,
} from "../../_actions/connectors";
import { requireUser, tenant } from "@/lib/auth";
import type { Tx } from "@/lib/db";
import { TogglPanel, TrelloPanel } from "./ImportPanel";
import { togglPanel } from "@/lib/connectors/toggl";
import { trelloPanel } from "@/lib/connectors/trello";
import { ga4Properties, googleAdsAccounts, metaAdAccounts } from "@/lib/connectors/ads";
import { readSecret, type Conn } from "@/lib/connectors/connections";
import { slackChannels } from "@/lib/connectors/messaging";
import { webhookUrl } from "@/lib/connectors/payments";
import { missingEnv, oauthRedirectUri, PROVIDERS, type ProviderDef, type ProviderKey } from "@/lib/connectors/providers";
import { hasSync } from "@/lib/connectors/sync";
import { formatShort } from "@/lib/domain/dates";
import { CONNECTORS, PHASES } from "@/lib/domain/connectors";
import { can } from "@/lib/permissions";
import { JOB_TEMPLATES } from "@/lib/templates";

export const metadata = { title: "Connector" };

/** What each connector keeps, in plain words (POPIA / GDPR). */
const STORES: Record<ProviderKey, string> = {
  gmail: "Sends only. Nothing is read from your mailbox.",
  google_calendar: "Title, time, length and attendee addresses of your meetings from the last 14 days. Never the description.",
  outlook: "Subject, time, length and attendee addresses of your meetings from the last 14 days. Sends Outbox email if an owner chooses this mailbox.",
  zoom: "Topic, start time and length of your meetings from the last 14 days.",
  slack: "Channel names, to map them to clients. Only posts; never reads messages.",
  whatsapp: "Sends Outbox messages. Incoming replies are matched to clients and the text is stored on the request or approval.",
  xero: "The Xero id of each invoice pushed, and its paid amount.",
  quickbooks: "The QuickBooks id of each invoice pushed, and its paid amount.",
  meta_ads: "Daily spend, clicks, impressions and conversions per mapped ad account.",
  google_ads: "Daily spend, clicks, impressions and conversions per mapped account.",
  ga4: "Weekly visitors, sessions and key events per mapped property.",
  hubspot: "Closed-won deals (name, amount, close date) and the companies and contacts on them.",
  google_drive: "Only files you link as versions, and the id of finals it files.",
  dropbox: "Only files you link as versions, and the id of finals it files.",
  figma: "Only frames you link as versions.",
  stripe: "The checkout id and amount of each payment.",
  paystack: "The transaction reference and amount of each payment.",
  payfast: "The payment id and amount of each payment.",
  toggl: "Toggl clients, projects and people, and each time entry's project, person, date, length and description.",
  trello: "Boards you map, and their cards: name, due date, list, members and whether it is complete.",
};

type Option = { id: string; label: string };

const VENDOR: Record<string, string> = { GOOGLE: "Google Cloud", MICROSOFT: "Microsoft Entra", SLACK: "Slack", XERO: "Xero", QUICKBOOKS: "Intuit", META: "Meta for Developers", HUBSPOT: "HubSpot", DROPBOX: "Dropbox", FIGMA: "Figma", ZOOM: "Zoom Marketplace" };

/** Live options to map from (channels, ad accounts, properties). A failure is shown, not thrown. */
async function options(tx: Tx, conn: Conn): Promise<{ list: Option[]; error?: string }> {
  try {
    if (conn.provider === "slack") return { list: await slackChannels(tx, conn) };
    if (conn.provider === "meta_ads") return { list: await metaAdAccounts(tx, conn) };
    if (conn.provider === "google_ads") return { list: await googleAdsAccounts(tx, conn) };
    if (conn.provider === "ga4") return { list: await ga4Properties(tx, conn) };
  } catch (e) {
    return { list: [], error: (e as Error).message };
  }
  return { list: [] };
}

const MAPS: Partial<Record<ProviderKey, { title: string; what: string; to: "client" | "job"; hint: string }>> = {
  slack: { title: "Client channels", what: "Channel", to: "client", hint: "Automation “Post to Slack” steps use the client's channel." },
  meta_ads: { title: "Ad accounts", what: "Ad account", to: "job", hint: "Each day's spend becomes a re-billable cost on the job. Map one account per job (a media flight or retainer)." },
  google_ads: { title: "Ad accounts", what: "Account", to: "job", hint: "Each day's spend becomes a re-billable cost on the job." },
  ga4: { title: "Client websites", what: "Property", to: "client", hint: "Weekly results go into the client's status report." },
  google_drive: { title: "Client folders", what: "Folder", to: "client", hint: "Approved finals are copied into the client's folder." },
  dropbox: { title: "Client folders", what: "Folder", to: "client", hint: "Approved finals are copied into the client's folder." },
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export default async function ConnectorPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const c = CONNECTORS.find((x) => x.key === key);
  if (!c) notFound();
  const user = await requireUser();
  const manager = can(user, "settings");
  const defs = PROVIDERS.filter((p) => p.catalog === key);

  const data = await tenant(user, async (tx) => {
    const conns = await tx.q<Conn & { connected_by_name: string | null }>(
      `select c.*, u.name as connected_by_name from connections c left join users u on u.id = c.connected_by
        where c.provider = any($1) and (c.user_id is null or c.user_id = $2)`,
      [defs.map((d) => d.key), user.id],
    );
    const live = conns.filter((x) => x.status === "active");
    return {
      conns,
      team: await tx.q<{ provider: string; name: string }>("select c.provider, u.name from connections c join users u on u.id = c.user_id where c.provider = any($1) and c.user_id <> $2 order by u.name", [defs.map((d) => d.key), user.id]),
      mappings: await tx.q<{ id: string; connection_id: string; external_label: string; external_id: string; company_name: string | null; job_label: string | null; settings: { markup?: number; monthly_budget?: number } }>(
        `select m.id, m.connection_id, m.external_label, m.external_id, co.name as company_name, j.number || ' ' || j.name as job_label, m.settings
           from connection_mappings m left join companies co on co.id = m.company_id left join jobs j on j.id = m.job_id
          where m.connection_id = any($1) order by co.name, m.external_label`,
        [conns.map((x) => x.id)],
      ),
      options: Object.fromEntries(await Promise.all(live.filter((x) => MAPS[x.provider] || x.provider === "slack").map(async (x) => [x.id, await options(tx, x)] as const))),
      clients: await tx.q<{ id: string; name: string }>("select id, name from companies where kind = 'client' and status <> 'former' order by name"),
      jobs: await tx.q<{ id: string; label: string }>(
        "select j.id, co.name || ' · ' || j.number || ' ' || j.name as label from jobs j join companies co on co.id = j.company_id where j.status <> 'closed' order by co.name, j.number",
      ),
      toggl: live.find((x) => x.provider === "toggl") ? await togglPanel(tx, live.find((x) => x.provider === "toggl")!) : null,
      trello: live.find((x) => x.provider === "trello") ? await trelloPanel(tx, live.find((x) => x.provider === "trello")!) : null,
      staff: await tx.q<{ id: string; name: string }>("select id, name from users where active order by name"),
      requested: Boolean(await tx.one("select 1 from connector_requests where connector = $1", [key])),
      // Non-secret key fields (merchant ID, sandbox…) to prefill the form; secrets are never sent to the page.
      saved: Object.fromEntries(
        await Promise.all(
          conns.map(async (x) => {
            const def = defs.find((d) => d.key === x.provider)!;
            if (def.auth.kind !== "apikey") return [x.provider, {}] as const;
            const sec = await readSecret(tx, x.id).catch(() => ({}) as Record<string, unknown>);
            return [x.provider, Object.fromEntries(def.auth.fields.filter((f) => !f.secret).map((f) => [f.key, sec[f.key]]))] as const;
          }),
        ),
      ) as Record<string, Record<string, unknown>>,
    };
  });

  return (
    <>
      <PageHeader
        back={{ href: "/app/connectors", label: "Connectors" }}
        title={
          <span className="flex items-center gap-3">
            <ConnectorIcon icon={c.icon} size="lg" /> {c.name}
          </span>
        }
        subtitle={c.summary}
      />

      {defs.length === 0 ? (
        <Card className="max-w-2xl">
          <p className="text-sm text-ink-2">{c.name} is on the roadmap ({PHASES[c.phase].label}: {PHASES[c.phase].detail.toLowerCase()}). Tell us you need it and we&apos;ll build it sooner.</p>
          <form action={toggleConnectorRequestAction} className="mt-4">
            <input type="hidden" name="connector" value={c.key} />
            <SubmitButton className={buttonClass(data.requested ? "secondary" : "primary", "sm")}>{data.requested ? "Requested by your agency" : "We want this"}</SubmitButton>
          </form>
        </Card>
      ) : (
        <div className="grid max-w-4xl gap-4">
          {defs.map((def) => {
            const conn = data.conns.find((x) => x.provider === def.key);
            return (
              <ProviderCard
                key={def.key}
                def={def}
                conn={conn}
                manager={manager}
                agencyId={user.agency_id}
                team={data.team.filter((t) => t.provider === def.key).map((t) => t.name)}
                mappings={data.mappings.filter((m) => m.connection_id === conn?.id)}
                opts={conn ? data.options[conn.id] : undefined}
                saved={data.saved[def.key] ?? {}}
                clients={data.clients}
                jobs={data.jobs}
                extra={
                  conn?.status === "active" && (manager || def.personal) ? (
                    def.key === "toggl" && data.toggl ? <TogglPanel connId={conn.id} data={data.toggl} clients={data.clients} team={data.staff} /> :
                    def.key === "trello" && data.trello ? <TrelloPanel connId={conn.id} boards={data.trello} clients={data.clients} jobs={data.jobs} /> : null
                  ) : null
                }
              />
            );
          })}
          <p className="flex items-start gap-2 text-xs text-ink-3">
            <ShieldCheck aria-hidden size={16} className="shrink-0" />
            Access is encrypted and used only by the features above. Disconnecting deletes everything synced from the app; records already created in 8gency (costs, clients, payments) stay.
          </p>
        </div>
      )}
    </>
  );
}

function ProviderCard({
  def, conn, manager, agencyId, team, mappings, opts, clients, jobs, saved, extra,
}: {
  def: ProviderDef;
  conn?: Conn & { connected_by_name: string | null };
  manager: boolean;
  agencyId: string;
  team: string[];
  mappings: { id: string; external_label: string; external_id: string; company_name: string | null; job_label: string | null; settings: { markup?: number; monthly_budget?: number } }[];
  opts?: { list: Option[]; error?: string };
  clients: { id: string; name: string }[];
  jobs: { id: string; label: string }[];
  saved: Record<string, unknown>;
  extra?: ReactNode;
}) {
  const canManage = def.personal || manager;
  const missing = missingEnv(def);
  const map = MAPS[def.key];
  const s = conn?.settings ?? {};
  const status = !conn ? <Badge>Not connected</Badge> : conn.status === "active" ? <Badge tone="good" dot>Connected</Badge> : <Badge tone="critical" dot>Needs reconnecting</Badge>;

  return (
    <Card title={<span className="flex items-center gap-2">{def.name} {def.personal && <span className="text-xs font-normal text-ink-3">Personal: each person connects their own</span>}</span>} actions={status}>
      <div className="space-y-4">
        <p className="text-sm text-ink-2">{def.note}</p>

        {conn ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-sm">
              <div className="font-medium">{conn.account_label || def.name}</div>
              <div className="text-xs text-ink-3">
                Connected {formatShort(conn.created_at.toISOString().slice(0, 10))}
                {conn.connected_by_name && !def.personal ? ` by ${conn.connected_by_name}` : ""}
                {conn.last_sync_at && ` · last synced ${conn.last_sync_at.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}`}
              </div>
              {s.last_summary && !conn.last_error && <div className="mt-1 text-xs text-ink-2">{String(s.last_summary)}</div>}
              {conn.last_error && (
                <div className="mt-1 flex items-start gap-1.5 text-xs text-critical-ink">
                  <WarningCircle aria-hidden size={14} className="mt-px shrink-0" /> {conn.last_error}
                </div>
              )}
            </div>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                {conn.status === "needs_reauth" && def.auth.kind === "oauth" && (
                  <a href={`/api/connectors/${def.key}/connect`} className={buttonClass("primary", "sm")}>
                    <Plugs aria-hidden size={14} /> Reconnect
                  </a>
                )}
                {conn.status === "active" && hasSync(def.key) && (
                  <form action={syncNowAction}>
                    <input type="hidden" name="id" value={conn.id} />
                    <SubmitButton className={buttonClass("secondary", "sm")}>
                      <ArrowsClockwise aria-hidden size={14} /> Sync now
                    </SubmitButton>
                  </form>
                )}
                <form action={disconnectAction}>
                  <input type="hidden" name="id" value={conn.id} />
                  <SubmitButton confirm={`Disconnect ${def.name}? Everything synced from it is deleted.`} className={buttonClass("ghost", "sm") + " !text-critical-ink"}>Disconnect</SubmitButton>
                </form>
              </div>
            )}
          </div>
        ) : !canManage ? (
          <p className="text-sm text-ink-3">An owner or operations lead connects this for the agency.</p>
        ) : missing.length ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-ink-2">
            <b className="font-medium text-ink">Not set up on this server yet.</b> Register an app with {def.auth.kind === "oauth" ? VENDOR[def.auth.app] : def.name} and add{" "}
            {missing.map((m, i) => (
              <span key={m}>
                {i > 0 && ", "}
                <code className="font-mono text-xs">{m}</code>
              </span>
            ))}{" "}
            to the environment.{def.auth.kind === "oauth" && <> Redirect URL: <code className="break-all font-mono text-xs">{oauthRedirectUri()}</code></>}
          </div>
        ) : def.auth.kind === "oauth" ? (
          <a href={`/api/connectors/${def.key}/connect`} className={buttonClass("primary")}>
            <Plugs aria-hidden size={16} /> Connect {def.name}
          </a>
        ) : null}

        {def.auth.kind === "apikey" && canManage && (
          <Section title={conn ? "Keys" : "Connect with your keys"}>
            <form action={saveKeysAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="provider" value={def.key} />
              {def.auth.fields.map((f) =>
                f.checkbox ? (
                  <label key={f.key} className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input type="checkbox" name={f.key} defaultChecked={Boolean(saved[f.key])} /> {f.label}
                  </label>
                ) : (
                  <Field key={f.key} label={f.label} hint={f.hint}>
                    <input name={f.key} type={f.secret ? "password" : "text"} autoComplete="off" defaultValue={f.secret ? undefined : String(saved[f.key] ?? "")} placeholder={f.secret && conn ? "Saved: leave blank to keep" : ""} />
                  </Field>
                ),
              )}
              <div className="sm:col-span-2">
                <SubmitButton className={buttonClass(conn ? "secondary" : "primary", "sm")}>{conn ? "Update keys" : `Connect ${def.name}`}</SubmitButton>
              </div>
            </form>
          </Section>
        )}

        {def.webhook && canManage && (
          <Section title="Webhook">
            <p className="mb-2 text-sm text-ink-2">
              {def.key === "whatsapp"
                ? "In Meta's WhatsApp settings, set this callback URL and the verify token below (shown once connected), and subscribe to messages."
                : def.key === "payfast"
                  ? "PayFast is sent this notify URL with every payment: nothing to set up. It must be reachable from the internet."
                  : `Add this URL as a webhook in ${def.name}${def.key === "stripe" ? " (event: checkout.session.completed), then paste its signing secret above" : ""}.`}
            </p>
            <input readOnly value={webhookUrl(def.key, agencyId)} aria-label="Webhook URL" className="font-mono text-xs" />
            {def.key === "whatsapp" && s.verify_token && <input readOnly value={String(s.verify_token)} aria-label="Verify token" className="mt-2 font-mono text-xs" />}
          </Section>
        )}

        {conn?.status === "active" && canManage && <SettingsForm def={def} conn={conn} manager={manager} opts={opts} />}

        {conn?.status === "active" && map && canManage && (
          <Section title={map.title}>
            <p className="mb-3 text-xs text-ink-3">{map.hint}</p>
            {opts?.error && <p className="mb-3 text-sm text-critical-ink">Couldn&apos;t load the list from {def.name}: {opts.error}</p>}
            <Table head={[map.what, map.to === "job" ? "Job" : "Client", ...(map.to === "job" ? ["Mark-up", "Monthly budget"] : []), ""]} empty={<Empty>Nothing mapped yet.</Empty>}>
              {mappings.map((m) => (
                <tr key={m.id}>
                  <Td>{m.external_label || m.external_id}</Td>
                  <Td>{map.to === "job" ? m.job_label : m.company_name}</Td>
                  {map.to === "job" && <Td>{Math.round((m.settings.markup ?? 0) * 100)}%</Td>}
                  {map.to === "job" && <Td>{m.settings.monthly_budget ? `R${m.settings.monthly_budget.toLocaleString("en-ZA")}` : "—"}</Td>}
                  <Td right>
                    <form action={deleteMappingAction}>
                      <input type="hidden" name="id" value={m.id} />
                      <SubmitButton aria-label="Remove mapping" className={buttonClass("ghost", "sm")}>
                        <Trash aria-hidden size={14} />
                      </SubmitButton>
                    </form>
                  </Td>
                </tr>
              ))}
            </Table>
            <form action={saveMappingAction} className="mt-3 flex flex-wrap items-end gap-3">
              <input type="hidden" name="connection_id" value={conn.id} />
              {def.key === "google_drive" || def.key === "dropbox" ? (
                <Field label={def.key === "google_drive" ? "Folder link" : "Folder path"} className="min-w-64 flex-1">
                  <input name="folder" placeholder={def.key === "google_drive" ? "https://drive.google.com/drive/folders/…" : "/Clients/Vela Health/Finals"} />
                </Field>
              ) : (
                <Field label={map.what} className="min-w-56 flex-1">
                  <select name="external_id" defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {opts?.list.map((o) => <option key={o.id} value={`${o.id}|${o.label}`}>{o.label}</option>)}
                  </select>
                </Field>
              )}
              {map.to === "job" ? (
                <>
                  <Field label="Job" className="min-w-56 flex-1">
                    <select name="job_id" defaultValue="">
                      <option value="" disabled>Choose…</option>
                      {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Mark-up %" className="w-28"><input name="markup" inputMode="decimal" defaultValue="0" /></Field>
                  <Field label="Monthly budget (R)" className="w-40"><input name="monthly_budget" inputMode="decimal" placeholder="Optional" /></Field>
                </>
              ) : (
                <Field label="Client" className="min-w-56 flex-1">
                  <select name="company_id" defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {clients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </Field>
              )}
              <SubmitButton className={buttonClass("secondary")}>Add</SubmitButton>
            </form>
          </Section>
        )}

        {def.personal && manager && team.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-ink-3">
            <CheckCircle aria-hidden size={14} /> Also connected: {team.join(", ")}
          </p>
        )}
        {extra}
        <p className="text-xs text-ink-3">Stores: {STORES[def.key]}</p>
      </div>
    </Card>
  );
}

function SettingsForm({ def, conn, manager, opts }: { def: ProviderDef; conn: Conn; manager: boolean; opts?: { list: Option[] } }) {
  const s = conn.settings;
  const fields: ReactNode =
    def.key === "outlook" ? (
      manager ? (
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="send_outbox" defaultChecked={Boolean(s.send_outbox)} /> Send the agency&apos;s Outbox email through this mailbox (used when Gmail isn&apos;t connected)
        </label>
      ) : null
    ) : def.key === "slack" ? (
      <Field label="Default channel" hint="For clients without their own channel.">
        <select name="default_channel" defaultValue={s.default_channel ? `${s.default_channel}|${s.default_channel_label ?? ""}` : ""}>
          <option value="">None</option>
          {opts?.list.map((o) => <option key={o.id} value={`${o.id}|${o.label}`}>{o.label}</option>)}
        </select>
      </Field>
    ) : def.key === "xero" ? (
      <>
        <Field label="Sales account code" hint="Where invoice lines are posted."><input name="account_code" defaultValue={s.account_code ?? "200"} /></Field>
        <Field label="VAT tax type" hint="Xero's code for your standard-rated sales."><input name="tax_type" defaultValue={s.tax_type ?? "OUTPUT"} /></Field>
        <Field label="Zero-rated tax type"><input name="zero_tax_type" defaultValue={s.zero_tax_type ?? "NONE"} /></Field>
        <Field label="Send invoices issued from" hint="Blank: from when you connected."><input type="date" name="push_from" defaultValue={s.push_from ?? ""} /></Field>
      </>
    ) : def.key === "quickbooks" ? (
      <>
        <Field label="Product/service ID" hint="The QuickBooks item invoice lines use."><input name="item_id" defaultValue={s.item_id ?? "1"} /></Field>
        <Field label="Tax code ID" hint="Needed outside the US."><input name="tax_code" defaultValue={s.tax_code ?? ""} /></Field>
        <Field label="Send invoices issued from" hint="Blank: from when you connected."><input type="date" name="push_from" defaultValue={s.push_from ?? ""} /></Field>
      </>
    ) : def.key === "google_ads" ? (
      <Field label="Manager account ID (optional)" hint="If your accounts sit under a manager (MCC) account."><input name="login_customer_id" defaultValue={s.login_customer_id ?? ""} placeholder="123-456-7890" /></Field>
    ) : def.key === "hubspot" ? (
      <Field label="Job template for won deals">
        <select name="template_key" defaultValue={s.template_key ?? "blank"}>
          {JOB_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
        </select>
      </Field>
    ) : null;
  if (!fields) return null;
  return (
    <Section title="Settings">
      <form action={saveConnectorSettingsAction} className="grid items-end gap-3 sm:grid-cols-2">
        <input type="hidden" name="id" value={conn.id} />
        {fields}
        <div className="sm:col-span-2">
          <SubmitButton className={buttonClass("secondary", "sm")}>Save settings</SubmitButton>
        </div>
      </form>
    </Section>
  );
}

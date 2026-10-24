import { withTenant, type Tx } from "../db";
import { activeConnection, api, ConnectorError, markNeedsReauth, readSecret, ReauthError, type Conn } from "./connections";
import { GRAPH } from "./versions";

// Sends what the Outbox queued, through the agency's own connected channels.
// Each message is its own transaction, so one failure never resends the rest.

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Msg {
  id: string;
  channel: "email" | "whatsapp" | "slack" | "calendar";
  via: string | null;
  to_name: string;
  to_address: string;
  subject: string;
  body: string;
  payload: Record<string, any>;
  attempts: number;
}

const MAX_ATTEMPTS = 5;

/** RFC 2047 for non-ASCII subjects and names. */
const word = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`);

export function mimeMessage(m: { toName: string; to: string; subject: string; body: string }) {
  const to = m.toName ? `${word(m.toName.replace(/["\r\n]/g, ""))} <${m.to}>` : m.to;
  return [
    `To: ${to}`,
    `Subject: ${word(m.subject.replace(/[\r\n]+/g, " "))}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(m.body).toString("base64").replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");
}

/** Which mailbox sends email: the step's choice, else Gmail, else an Outlook mailbox an owner chose for the Outbox. */
async function mailbox(tx: Tx, via: string | null): Promise<Conn | null> {
  if (via === "gmail" || !via) {
    const g = await activeConnection(tx, "gmail");
    if (g || via === "gmail") return g;
  }
  return tx.one<Conn>("select * from connections where provider = 'outlook' and status = 'active' and (settings->>'send_outbox')::boolean order by created_at limit 1");
}

async function send(tx: Tx, m: Msg): Promise<{ id: string; via: string } | null> {
  if (m.channel === "email") {
    const conn = await mailbox(tx, m.via);
    if (!conn) return null;
    if (conn.provider === "gmail") {
      const raw = Buffer.from(mimeMessage({ toName: m.to_name, to: m.to_address, subject: m.subject, body: m.body })).toString("base64url");
      const r = await api(tx, conn, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", json: { raw } });
      return { id: r.id, via: "gmail" };
    }
    await api(tx, conn, "https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      json: { message: { subject: m.subject, body: { contentType: "Text", content: m.body }, toRecipients: [{ emailAddress: { address: m.to_address, name: m.to_name } }] }, saveToSentItems: true },
    });
    return { id: "", via: "outlook" };
  }

  if (m.channel === "whatsapp") {
    const conn = await activeConnection(tx, "whatsapp");
    if (!conn) return null;
    const s = await readSecret(tx, conn.id);
    const to = m.to_address.replace(/[^0-9]/g, "");
    const url = `https://graph.facebook.com/${GRAPH}/${s.phone_number_id}/messages`;
    try {
      const r = await api(tx, conn, url, { method: "POST", json: { messaging_product: "whatsapp", to, type: "text", text: { body: m.body, preview_url: true } } });
      return { id: r.messages?.[0]?.id ?? "", via: "whatsapp" };
    } catch (e) {
      // 131047: outside the 24-hour window, only an approved template may be sent.
      if (!(e instanceof ConnectorError) || !/131047|re-engagement/i.test(e.message) || !s.template) throw e;
      const r = await api(tx, conn, url, {
        method: "POST",
        json: { messaging_product: "whatsapp", to, type: "template", template: { name: s.template, language: { code: s.template_language || "en" }, components: [{ type: "body", parameters: [{ type: "text", text: m.body.slice(0, 1000) }] }] } },
      });
      return { id: r.messages?.[0]?.id ?? "", via: "whatsapp template" };
    }
  }

  if (m.channel === "slack") {
    const conn = await activeConnection(tx, "slack");
    if (!conn) return null;
    const r = await api(tx, conn, "https://slack.com/api/chat.postMessage", { method: "POST", json: { channel: m.to_address, text: m.body, unfurl_links: false } });
    if (!r.ok) throw new ConnectorError(`Slack: ${r.error}${r.error === "not_in_channel" ? " (invite the 8gency app to the channel)" : ""}`);
    return { id: r.ts, via: "slack" };
  }

  // Calendar event on a person's own connected calendar.
  const p = m.payload as { user_id: string; start: string; minutes: number; attendees?: string[] };
  const g = await activeConnection(tx, "google_calendar", p.user_id);
  const end = new Date(new Date(p.start).getTime() + (p.minutes || 30) * 60_000).toISOString();
  const attendees = (p.attendees ?? []).filter(Boolean);
  if (g) {
    const r = await api(tx, g, `https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=${attendees.length ? "all" : "none"}`, {
      method: "POST",
      json: { summary: m.subject, description: m.body, start: { dateTime: p.start }, end: { dateTime: end }, attendees: attendees.map((email) => ({ email })) },
    });
    return { id: r.id, via: "google_calendar" };
  }
  throw new ConnectorError(`${m.to_name || "That person"} hasn't connected Google Calendar.`);
}

/** Deliver queued messages. Messages for channels that aren't connected stay queued and visible in the Outbox. */
export async function deliverOutbox(agencyId: string, limit = 50) {
  const queued = await withTenant({ agencyId }, (tx) => tx.q<{ id: string }>("select id from outbox_messages where status = 'queued' order by created_at limit $1", [limit]));
  let sent = 0;
  for (const { id } of queued) {
    sent += await withTenant({ agencyId, actorLabel: "outbox" }, async (tx) => {
      const m = await tx.one<Msg>("select * from outbox_messages where id = $1 and status = 'queued' for update skip locked", [id]);
      if (!m) return 0;
      try {
        const r = await send(tx, m);
        if (!r) return 0;
        await tx.q("update outbox_messages set status = 'sent', sent_at = now(), via = $2, provider_message_id = $3, error = null, attempts = attempts + 1 where id = $1", [id, r.via, r.id]);
        return 1;
      } catch (e) {
        if (e instanceof ReauthError) await markNeedsReauth(tx, e.conn, e.message);
        const failed = !(e instanceof ReauthError) && m.attempts + 1 >= MAX_ATTEMPTS;
        await tx.q("update outbox_messages set attempts = attempts + 1, error = $2, status = $3 where id = $1", [id, (e as Error).message.slice(0, 500), failed ? "failed" : "queued"]);
        return 0;
      }
    });
  }
  return sent;
}

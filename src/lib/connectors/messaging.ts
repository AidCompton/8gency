import { createHmac } from "node:crypto";
import type { Tx } from "../db";
import { safeEqual } from "../vault";
import { api, readSecret, type Conn } from "./connections";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function slackChannels(tx: Tx, conn: Conn) {
  const r = await api(tx, conn, "https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=500");
  if (!r.ok) throw new Error(`Slack: ${r.error}`);
  return (r.channels ?? []).map((c: any) => ({ id: c.id as string, label: `#${c.name}` })).sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label));
}

/** Meta signs webhook bodies with the app secret (X-Hub-Signature-256). */
export async function verifyWhatsapp(tx: Tx, conn: Conn, raw: string, header: string | null) {
  const s = await readSecret(tx, conn.id);
  const want = `sha256=${createHmac("sha256", String(s.app_secret ?? "")).update(raw).digest("hex")}`;
  return Boolean(s.app_secret) && safeEqual(want, header ?? "");
}

/** Incoming texts (for processInbound) and failed deliveries (to flag in the Outbox). */
export function parseWhatsapp(body: any) {
  const messages: { from: string; text: string }[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const entry of body?.entry ?? [])
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      for (const m of v.messages ?? []) {
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? "";
        if (text) messages.push({ from: `+${m.from}`, text });
      }
      for (const st of v.statuses ?? []) if (st.status === "failed") failed.push({ id: st.id, error: st.errors?.[0]?.title ?? "Delivery failed" });
    }
  return { messages, failed };
}

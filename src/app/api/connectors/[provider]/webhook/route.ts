import { withTenant } from "@/lib/db";
import { activeConnection } from "@/lib/connectors/connections";
import { parseWhatsapp, verifyWhatsapp } from "@/lib/connectors/messaging";
import { handlePaymentWebhook, PAY_PROVIDERS, type PayProvider } from "@/lib/connectors/payments";
import { processInbound } from "@/lib/services/inbound";
import { safeEqual } from "@/lib/vault";

// Incoming webhooks. Each agency registers its own URL (?a=<agency id>, shown
// on the connector's page); every payload is verified against that agency's
// stored secret before anything is read from it.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function agencyOf(req: Request) {
  const a = new URL(req.url).searchParams.get("a") ?? "";
  return UUID.test(a) ? a : null;
}

/** Meta's one-time subscription check for the WhatsApp webhook. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const agencyId = agencyOf(req);
  const q = new URL(req.url).searchParams;
  if (provider !== "whatsapp" || !agencyId || q.get("hub.mode") !== "subscribe") return new Response("not found", { status: 404 });
  const token = await withTenant({ agencyId }, async (tx) => (await activeConnection(tx, "whatsapp"))?.settings.verify_token as string | undefined);
  if (!token || !safeEqual(token, q.get("hub.verify_token") ?? "")) return new Response("forbidden", { status: 403 });
  return new Response(q.get("hub.challenge") ?? "", { status: 200 });
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const agencyId = agencyOf(req);
  if (!agencyId) return new Response("not found", { status: 404 });
  const raw = await req.text();

  if ((PAY_PROVIDERS as readonly string[]).includes(provider)) {
    const r = await withTenant({ agencyId, actorLabel: `${provider} webhook` }, (tx) => handlePaymentWebhook(tx, provider as PayProvider, { raw, headers: req.headers }));
    return new Response(r.body, { status: r.status });
  }

  if (provider === "whatsapp") {
    const ok = await withTenant({ agencyId, actorLabel: "WhatsApp webhook" }, async (tx) => {
      const conn = await activeConnection(tx, "whatsapp");
      if (!conn || !(await verifyWhatsapp(tx, conn, raw, req.headers.get("x-hub-signature-256")))) return null;
      const parsed = parseWhatsapp(JSON.parse(raw));
      for (const f of parsed.failed) await tx.q("update outbox_messages set status = 'failed', error = $2 where provider_message_id = $1", [f.id, f.error]);
      return parsed;
    });
    if (!ok) return new Response("bad signature", { status: 401 });
    for (const m of ok.messages) await processInbound({ channel: "whatsapp", from: m.from, text: m.text }).catch((e) => console.error("whatsapp inbound", e));
    return new Response("ok");
  }

  return new Response("not found", { status: 404 });
}

import { timingSafeEqual } from "node:crypto";
import { processInbound } from "@/lib/services/inbound";

/**
 * Inbound email replies and WhatsApp messages (M06). An email provider's
 * inbound-parse webhook or a WhatsApp Business Platform relay posts
 * { from, text } here with the shared secret in the x-8gency-secret header.
 * Provider-specific payload adapters belong in front of this endpoint.
 */
export async function POST(req: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  if (channel !== "email" && channel !== "whatsapp") return Response.json({ error: "unknown channel" }, { status: 404 });
  const secret = process.env.INBOUND_WEBHOOK_SECRET ?? "";
  const given = req.headers.get("x-8gency-secret") ?? "";
  if (!secret || secret === "change-me" || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { from?: string; text?: string } | null;
  if (!body?.from || !body?.text) return Response.json({ error: "from and text are required" }, { status: 400 });
  try {
    return Response.json(await processInbound({ channel, from: body.from, text: body.text }));
  } catch (e) {
    return Response.json({ status: "ignored", detail: (e as Error).message }, { status: 200 });
  }
}

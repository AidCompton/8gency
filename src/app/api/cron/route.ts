import { timingSafeEqual } from "node:crypto";
import { adminQuery, withTenant } from "@/lib/db";
import { runAutomations } from "@/lib/services/automations";

/** Scheduler entry point: runs the automation library for every agency. */
export async function POST(req: Request) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET ?? "";
  const given = req.headers.get("x-8gency-secret") ?? "";
  if (!secret || secret === "change-me" || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  const agencies = await adminQuery<{ id: string }>("select id from agencies");
  const results: { agency: string; ok: boolean; error?: string }[] = [];
  for (const a of agencies) {
    try {
      await withTenant({ agencyId: a.id, actorLabel: "automation" }, (tx) => runAutomations(tx));
      results.push({ agency: a.id, ok: true });
    } catch (e) {
      results.push({ agency: a.id, ok: false, error: (e as Error).message });
    }
  }
  return Response.json({ ran: results.length, failed: results.filter((r) => !r.ok).length });
}

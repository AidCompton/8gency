import { timingSafeEqual } from "node:crypto";
import { adminQuery, withTenant } from "@/lib/db";
import { runConnectors } from "@/lib/connectors/sync";
import { runAutomations } from "@/lib/services/automations";
import { purgeUnsentChatFiles } from "@/lib/services/chat";
import { sendChatNudges } from "@/lib/services/chatNudges";
import { qualifyReferrals } from "@/lib/services/referrals";
import { purgeIdempotencyKeys } from "@/lib/idempotency";
import { sendTimesheetReminders, sendWeeklyEmails } from "@/lib/services/weekly";

/** Scheduler entry point (every few minutes): automations, then connector syncs and Outbox delivery, for every agency. */
export async function POST(req: Request) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET ?? "";
  const given = req.headers.get("x-8gency-secret") ?? "";
  if (!secret || secret === "change-me" || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  await sendChatNudges().catch((e) => console.error("chat nudges failed", e));
  await purgeUnsentChatFiles().catch((e) => console.error("chat file purge failed", e));
  await purgeIdempotencyKeys().catch((e) => console.error("idempotency purge failed", e));
  await qualifyReferrals().catch((e) => console.error("referrals failed", e));
  await sendWeeklyEmails().catch((e) => console.error("weekly emails failed", e));
  await sendTimesheetReminders().catch((e) => console.error("timesheet reminders failed", e));
  const agencies = await adminQuery<{ id: string }>("select id from agencies");
  const results: { agency: string; ok: boolean; error?: string }[] = [];
  for (const a of agencies) {
    try {
      await withTenant({ agencyId: a.id, actorLabel: "automation" }, (tx) => runAutomations(tx));
      await runConnectors(a.id);
      results.push({ agency: a.id, ok: true });
    } catch (e) {
      results.push({ agency: a.id, ok: false, error: (e as Error).message });
    }
  }
  return Response.json({ ran: results.length, failed: results.filter((r) => !r.ok).length });
}

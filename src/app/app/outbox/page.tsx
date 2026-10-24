import { PaperPlaneTilt, WarningCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, Card, Empty, PageHeader, StatusBadge, buttonClass, type Tone } from "@/components/ui";
import { deliverNowAction } from "../_actions/connectors";
import { requireCap, requireUser, tenant } from "@/lib/auth";

export const metadata = { title: "Outbox" };

const CHANNEL: Record<string, { label: string; tone: Tone; connect: string }> = {
  email: { label: "Email", tone: "info", connect: "gmail" },
  whatsapp: { label: "WhatsApp", tone: "good", connect: "whatsapp" },
  slack: { label: "Slack", tone: "brand", connect: "slack" },
  calendar: { label: "Calendar", tone: "warning", connect: "google_calendar" },
};
const VIA: Record<string, string> = { gmail: "Gmail", outlook: "Outlook", whatsapp: "WhatsApp Business", "whatsapp template": "WhatsApp template", slack: "Slack", google_calendar: "Google Calendar" };

export default async function OutboxPage() {
  const user = await requireUser();
  requireCap(user, "settings");
  const data = await tenant(user, async (tx) => ({
    rows: await tx.q<{ id: string; channel: string; to_name: string; to_address: string; subject: string; body: string; status: string; created_at: Date; via: string | null; error: string | null; attempts: number }>(
      "select id, channel, to_name, to_address, subject, body, status, created_at, via, error, attempts from outbox_messages order by created_at desc limit 100",
    ),
    queued: (await tx.one<{ n: number }>("select count(*)::int as n from outbox_messages where status = 'queued'"))!.n,
  }));
  return (
    <>
      <PageHeader
        title="Outbox"
        subtitle="Every email, WhatsApp, Slack post and calendar booking 8gency sends. They go out through your connected apps every few minutes; anything for an app that isn't connected waits here."
        actions={
          data.queued > 0 && (
            <form action={deliverNowAction}>
              <SubmitButton className={buttonClass("primary")}>
                <PaperPlaneTilt aria-hidden size={16} /> Deliver {data.queued} now
              </SubmitButton>
            </form>
          )
        }
      />
      <div className="space-y-3">
        {data.rows.length === 0 && <Empty>Nothing has been sent yet. Invoices, approvals and reminders queue here.</Empty>}
        {data.rows.map((m) => {
          const ch = CHANNEL[m.channel] ?? CHANNEL.email;
          return (
            <Card key={m.id}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge tone={ch.tone}>{ch.label}</Badge>
                  <b>{m.to_name}</b> <span className="wrap-anywhere text-ink-3">&lt;{m.to_address}&gt;</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-ink-3">
                  {m.via && m.status === "sent" && <span>via {VIA[m.via] ?? m.via}</span>}
                  <StatusBadge status={m.status} /> {new Date(m.created_at).toLocaleString("en-ZA")}
                </span>
              </div>
              {m.subject && <div className="mt-2 font-medium">{m.subject}</div>}
              <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-ink-2 wrap-anywhere">{m.body}</pre>
              {m.error && m.status !== "sent" && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-critical-ink">
                  <WarningCircle aria-hidden size={14} className="mt-px shrink-0" /> {m.error} {m.status === "queued" && `(tried ${m.attempts}×, will retry)`}
                </p>
              )}
              {m.status === "queued" && !m.error && (
                <p className="mt-2 text-xs text-ink-3">
                  Waiting to send. <Link href={`/app/connectors/${ch.connect}`} className="text-brand hover:underline">Connect {ch.label === "Email" ? "Gmail or Outlook" : ch.label}</Link> if it isn&apos;t yet.
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}

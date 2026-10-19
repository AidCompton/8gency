import { Badge, Card, PageHeader } from "@/components/ui";
import { requireCap, requireUser, tenant } from "@/lib/auth";


export const metadata = { title: "Outbox" };

export default async function OutboxPage() {
  const user = await requireUser();
  requireCap(user, "settings");
  const rows = await tenant(user, (tx) =>
    tx.q<{ id: string; channel: string; to_name: string; to_address: string; subject: string; body: string; status: string; created_at: Date }>(
      "select id, channel, to_name, to_address, subject, body, status, created_at from outbox_messages order by created_at desc limit 100",
    ),
  );
  return (
    <>
      <PageHeader title="Outbox" subtitle="Every email and WhatsApp message 8gency sends to clients. Connect an email provider and the WhatsApp Business Platform to deliver them; until then they queue here." />
      <div className="space-y-3">
        {rows.map((m) => (
          <Card key={m.id}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span><Badge tone={m.channel === "whatsapp" ? "good" : "info"}>{m.channel}</Badge> <b>{m.to_name}</b> <span className="text-ink-3">&lt;{m.to_address}&gt;</span></span>
              <span className="text-xs text-ink-3">{m.status} · {new Date(m.created_at).toLocaleString("en-ZA")}</span>
            </div>
            {m.subject && <div className="mt-2 font-medium">{m.subject}</div>}
            <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-ink-2">{m.body}</pre>
          </Card>
        ))}
      </div>
    </>
  );
}

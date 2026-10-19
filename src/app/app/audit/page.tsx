import { Card, PageHeader, Table, Td } from "@/components/ui";
import { requireUser, tenant } from "@/lib/auth";
import { assertCan, can } from "@/lib/permissions";

export const metadata = { title: "Audit log" };

const MONEY_KEYS = /cost|rate_cents|margin|salary/i;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q ?? "";
  const user = await requireUser();
  assertCan(user, "audit");
  const rows = await tenant(user, (tx) =>
    tx.q<{ id: number; actor_label: string; action: string; record_type: string; record_id: string | null; before: unknown; after: unknown; created_at: Date }>(
      `select id, actor_label, action, record_type, record_id, before, after, created_at from audit_events
        where ($1 = '' or action ilike '%' || $1 || '%' or actor_label ilike '%' || $1 || '%' or record_type ilike '%' || $1 || '%')
        order by id desc limit 300`,
      [q],
    ),
  );
  const show = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = JSON.stringify(v, (k, val) => (!can(user, "seeCostRates") && MONEY_KEYS.test(k) ? "•••" : val));
    return s.length > 220 ? `${s.slice(0, 220)}…` : s;
  };
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every approval, financial change, permission change and export, with before and after values. Immutable." />
      <form className="mb-4 max-w-sm"><input name="q" defaultValue={q} placeholder="Filter by action, person or record…" /></form>
      <Card pad={false}>
        <Table head={["When", "Who", "Action", "Record", "Before → after"]}>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td className="whitespace-nowrap text-xs text-ink-3">{new Date(r.created_at).toLocaleString("en-ZA")}</Td>
              <Td>{r.actor_label}</Td>
              <Td><code className="text-xs">{r.action}</code></Td>
              <Td className="text-xs text-ink-2">{r.record_type}</Td>
              <Td className="max-w-[28rem] break-all text-xs text-ink-2">{show(r.before)}{r.before ? " → " : ""}{show(r.after)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

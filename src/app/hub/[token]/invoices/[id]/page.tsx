import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { Card, Money, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/domain/dates";
import { asContact, resolveHubToken } from "@/lib/services/hub";

export default async function HubInvoice({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const contact = await resolveHubToken(token);
  if (!contact || !["billing", "approver"].includes(contact.role)) notFound();
  const data = await asContact(contact, async (tx) => {
    const inv = await tx.one<{ number: string; status: string; issue_date: string; due_date: string; currency: string; po_number: string; tax_label: string; tax_rate: number; subtotal_cents: number; tax_cents: number; total_cents: number; paid_cents: number; entity_id: string; company_id: string }>(
      "select * from invoices where id = $1 and company_id = $2 and status in ('sent','paid')",
      [id, contact.company_id],
    );
    if (!inv) return null;
    return {
      inv,
      lines: await tx.q<{ id: string; description: string; quantity: number; unit_cents: number; amount_cents: number }>("select id, description, quantity, unit_cents, amount_cents from invoice_lines where invoice_id = $1 order by sort", [id]),
      entity: (await tx.one<{ legal_name: string; tax_number: string; address: string; bank_details: string }>("select legal_name, tax_number, address, bank_details from entities where id = $1", [inv.entity_id]))!,
    };
  });
  if (!data) notFound();
  const { inv, lines, entity } = data;
  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between"><Link href={`/hub/${token}`} className="text-sm text-ink-3 hover:text-ink">← Everything</Link><PrintButton /></div>
      <Card>
        <div className="flex flex-wrap justify-between gap-3">
          <div><div className="font-semibold">{entity.legal_name}</div><div className="whitespace-pre-line text-xs text-ink-2">{entity.address}</div>{entity.tax_number && <div className="text-xs text-ink-2">VAT no. {entity.tax_number}</div>}</div>
          <div className="text-right"><div className="font-semibold">TAX INVOICE {inv.number}</div><div className="text-xs text-ink-2">Issued {formatDate(inv.issue_date)} · Due {formatDate(inv.due_date)}</div><StatusBadge status={inv.status} /></div>
        </div>
        {inv.po_number && <p className="mt-3 text-sm">Your PO: <b>{inv.po_number}</b></p>}
        <ul className="mt-4 divide-y divide-line text-sm">{lines.map((l) => <li key={l.id} className="flex justify-between gap-3 py-2"><span>{l.description}{l.quantity !== 1 ? ` × ${l.quantity}` : ""}</span><Money cents={l.amount_cents} currency={inv.currency} /></li>)}</ul>
        <dl className="ml-auto mt-3 w-60 space-y-1 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd><Money cents={inv.subtotal_cents} currency={inv.currency} /></dd></div>
          <div className="flex justify-between"><dt>{inv.tax_label}</dt><dd><Money cents={inv.tax_cents} currency={inv.currency} /></dd></div>
          <div className="flex justify-between font-semibold"><dt>Total</dt><dd><Money cents={inv.total_cents} currency={inv.currency} /></dd></div>
          {inv.status === "sent" && <div className="flex justify-between font-semibold"><dt>Due</dt><dd><Money cents={inv.total_cents - inv.paid_cents} currency={inv.currency} /></dd></div>}
        </dl>
        <div className="mt-4 border-t border-line pt-3 text-xs text-ink-2"><div className="whitespace-pre-line">{entity.bank_details}</div>Reference: {inv.number}</div>
        <p className="mt-3 text-xs text-ink-3">Card payment links (PayFast, Paystack, Stripe) can be switched on per agency; EFT details are above.</p>
      </Card>
    </div>
  );
}

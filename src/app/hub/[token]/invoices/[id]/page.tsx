import { ArrowLeft, CreditCard } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoicePaper, PaperLines, PaperTotals } from "@/components/InvoicePaper";
import { PrintButton } from "@/components/PrintButton";
import { SubmitButton } from "@/components/SubmitButton";
import { Money, buttonClass } from "@/components/ui";
import { payOptions, type PayProvider } from "@/lib/connectors/payments";
import { hubPayAction } from "../../actions";

const PAY_LABEL: Record<PayProvider, string> = { payfast: "PayFast", paystack: "Paystack", stripe: "card (Stripe)" };
import { formatDate } from "@/lib/domain/dates";
import { asContact, resolveHubToken } from "@/lib/services/hub";

export default async function HubInvoice({ params, searchParams }: { params: Promise<{ token: string; id: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { token, id } = await params;
  const { paid } = await searchParams;
  const contact = await resolveHubToken(token);
  if (!contact || !["billing", "approver"].includes(contact.role)) notFound();
  const data = await asContact(contact, async (tx) => {
    const inv = await tx.one<{ number: string; status: string; issue_date: string; due_date: string; currency: string; po_number: string; tax_label: string; tax_rate: number; subtotal_cents: number; tax_cents: number; total_cents: number; paid_cents: number; notes: string; entity_id: string; company_id: string }>(
      "select * from invoices where id = $1 and company_id = $2 and status in ('sent','paid')",
      [id, contact.company_id],
    );
    if (!inv) return null;
    return {
      inv,
      lines: await tx.q<{ id: string; description: string; quantity: number; unit_cents: number; amount_cents: number }>("select id, description, quantity, unit_cents, amount_cents from invoice_lines where invoice_id = $1 order by sort", [id]),
      pay: await payOptions(tx),
      entity: (await tx.one<{ name: string; legal_name: string; tax_number: string; registration_number: string; address: string; bank_details: string }>("select name, legal_name, tax_number, registration_number, address, bank_details from entities where id = $1", [inv.entity_id]))!,
    };
  });
  if (!data) notFound();
  const { inv, lines, entity, pay } = data;
  const due = inv.total_cents - inv.paid_cents;
  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between">
        <Link href={`/hub/${token}`} className="group inline-flex items-center gap-1 text-sm text-ink-3 transition-colors hover:text-ink">
          <ArrowLeft aria-hidden size={14} className="transition-transform group-hover:-translate-x-0.5" /> Everything
        </Link>
        <PrintButton />
      </div>
      <InvoicePaper
        logoUrl={contact.agency_logo_v ? `/api/logo?hub=${encodeURIComponent(token)}&v=${contact.agency_logo_v}` : null}
        agencyName={contact.agency_name}
        brandColor={contact.agency_color}
        entity={entity}
        heading={inv.tax_rate > 0 ? "Tax invoice" : "Invoice"}
        number={inv.number}
        meta={[
          { label: "Issued", value: formatDate(inv.issue_date) },
          { label: "Due", value: formatDate(inv.due_date) },
          ...(inv.po_number ? [{ label: "Your PO", value: inv.po_number }] : []),
        ]}
        billTo={{ name: contact.company_name, lines: [`Attn: ${contact.name}`] }}
        amountDue={inv.status === "sent" ? { cents: due, currency: inv.currency, label: "Amount due" } : undefined}
        stamp={inv.status === "paid" ? { label: "Paid", tone: "good" } : undefined}
        footer={
          <>
            <div className="whitespace-pre-line">{entity.bank_details}</div>
            <div>Payment reference: {inv.number}</div>
            {inv.notes && <div className="mt-2 whitespace-pre-line">{inv.notes}</div>}
          </>
        }
      >
        <PaperLines lines={lines} currency={inv.currency} />
        <PaperTotals
          rows={[
            { label: "Subtotal", value: <Money cents={inv.subtotal_cents} currency={inv.currency} /> },
            { label: `${inv.tax_label} ${Math.round(inv.tax_rate * 1000) / 10}%`, value: <Money cents={inv.tax_cents} currency={inv.currency} />, muted: true },
            { label: "Total", value: <Money cents={inv.total_cents} currency={inv.currency} />, strong: true },
            ...(inv.paid_cents > 0 ? [{ label: "Paid", value: <Money cents={-inv.paid_cents} currency={inv.currency} />, muted: true }] : []),
          ]}
        />
      </InvoicePaper>
      {inv.status === "sent" && due > 0 && pay.length > 0 && (
        <div className="no-print flex flex-col items-center gap-2">
          {paid ? (
            <p className="rounded-lg bg-good/10 px-4 py-2 text-sm text-good-ink">Thank you. Your payment is being confirmed and this invoice will show as paid shortly.</p>
          ) : (
            <form action={hubPayAction} className="flex flex-wrap justify-center gap-2">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="invoice_id" value={id} />
              {pay.map((p, i) => (
                <SubmitButton key={p} name="provider" value={p} className={buttonClass(i === 0 ? "primary" : "secondary")}>
                  <CreditCard aria-hidden size={16} /> Pay <Money cents={due} currency={inv.currency} /> {pay.length > 1 && `with ${PAY_LABEL[p]}`}
                </SubmitButton>
              ))}
            </form>
          )}
        </div>
      )}
      <p className="no-print text-center text-xs text-ink-3">{pay.length > 0 && inv.status === "sent" ? "Or pay" : "Pay"} by EFT using the details above, with the invoice number as your reference.</p>
    </div>
  );
}

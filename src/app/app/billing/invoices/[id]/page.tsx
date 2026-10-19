import { notFound } from "next/navigation";
import { addLineAction, recordPaymentAction, sendInvoiceAction, updateDraftAction, voidInvoiceAction, writeOffAction } from "../../../_actions/billing";
import { PrintButton } from "@/components/PrintButton";
import { Badge, Card, Field, Money, PageHeader, StatusBadge, buttonClass } from "@/components/ui";
import { requireCap, requireUser, tenant } from "@/lib/auth";
import { formatDate } from "@/lib/domain/dates";

import { WRITE_OFF_REASONS } from "@/lib/services/billing";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  requireCap(user, "billing");
  const data = await tenant(user, async (tx) => {
    const inv = await tx.one<{
      id: string; number: string | null; status: string; issue_date: string | null; due_date: string | null; currency: string; exchange_rate: number; po_number: string;
      tax_label: string; tax_rate: number; subtotal_cents: number; tax_cents: number; total_cents: number; paid_cents: number; notes: string; company_id: string; entity_id: string;
    }>("select * from invoices where id = $1", [id]);
    if (!inv) return null;
    return {
      inv,
      lines: await tx.q<{ id: string; description: string; quantity: number; unit_cents: number; amount_cents: number; source_type: string }>("select id, description, quantity, unit_cents, amount_cents, source_type from invoice_lines where invoice_id = $1 order by sort, id", [id]),
      company: (await tx.one<{ name: string; po_required: boolean; billing_email: string; code: string }>("select name, po_required, billing_email, code from companies where id = $1", [inv.company_id]))!,
      entity: (await tx.one<{ legal_name: string; name: string; tax_number: string; registration_number: string; address: string; bank_details: string }>("select * from entities where id = $1", [inv.entity_id]))!,
      writeOffs: await tx.q<{ amount_cents: number; reason: string; note: string; created_at: Date }>("select amount_cents, reason, note, created_at from write_offs where invoice_id = $1", [id]),
      agency: (await tx.one<{ name: string; brand_color: string }>("select name, brand_color from agencies where id = $1", [tx.agencyId]))!,
    };
  });
  if (!data) notFound();
  const { inv, lines, company, entity } = data;
  const writtenOff = data.writeOffs.reduce((s, w) => s + w.amount_cents, 0);
  const outstanding = inv.total_cents - inv.paid_cents - writtenOff;
  const draft = inv.status === "draft";
  return (
    <>
      <div className="no-print">
        <PageHeader back={{ href: "/app/billing?tab=invoices", label: "Invoices" }} title={<span className="flex items-center gap-2">{inv.number ?? "Draft invoice"} <StatusBadge status={inv.status} /></span>} subtitle={company.name}
          actions={<PrintButton />} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <article className="rounded-xl border border-line bg-white p-8 text-[#111] print:border-0 print:p-0">
          <header className="flex flex-wrap justify-between gap-4">
            <div>
              <div className="text-2xl font-bold" style={{ color: data.agency.brand_color }}>{entity.legal_name || entity.name}</div>
              <div className="mt-1 whitespace-pre-line text-xs text-[#555]">{entity.address}</div>
              <div className="text-xs text-[#555]">{entity.registration_number && `Reg ${entity.registration_number} · `}{entity.tax_number && `VAT no. ${entity.tax_number}`}</div>
            </div>
            <div className="text-right">
              <div className="text-xl font-semibold">{inv.tax_rate > 0 ? "TAX INVOICE" : "INVOICE"}</div>
              <div className="text-sm">{inv.number ?? "DRAFT"}</div>
              <div className="text-xs text-[#555]">Issued {formatDate(inv.issue_date)} · Due {formatDate(inv.due_date)}</div>
            </div>
          </header>
          <section className="mt-6 text-sm">
            <div className="text-xs uppercase text-[#777]">Bill to</div>
            <div className="font-medium">{company.name}</div>
            {inv.po_number && <div>PO number: <b>{inv.po_number}</b></div>}
          </section>
          <table className="mt-6 w-full text-sm">
            <thead><tr className="border-b border-[#ddd] text-left text-xs uppercase text-[#777]"><th className="py-2">Description</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Unit</th><th className="py-2 text-right">Amount</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-[#eee]"><td className="py-2 pr-2">{l.description}</td><td className="py-2 text-right tnum">{l.quantity}</td><td className="py-2 text-right"><Money cents={l.unit_cents} currency={inv.currency} /></td><td className="py-2 text-right"><Money cents={l.amount_cents} currency={inv.currency} /></td></tr>
              ))}
            </tbody>
          </table>
          <dl className="ml-auto mt-4 w-64 space-y-1 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd><Money cents={inv.subtotal_cents} currency={inv.currency} /></dd></div>
            <div className="flex justify-between"><dt>{inv.tax_label} {Math.round(inv.tax_rate * 1000) / 10}%</dt><dd><Money cents={inv.tax_cents} currency={inv.currency} /></dd></div>
            <div className="flex justify-between border-t border-[#ddd] pt-1 font-semibold"><dt>Total</dt><dd><Money cents={inv.total_cents} currency={inv.currency} /></dd></div>
            {inv.paid_cents > 0 && <div className="flex justify-between text-[#555]"><dt>Paid</dt><dd><Money cents={-inv.paid_cents} currency={inv.currency} /></dd></div>}
            {writtenOff > 0 && <div className="flex justify-between text-[#555]"><dt>Written off</dt><dd><Money cents={-writtenOff} currency={inv.currency} /></dd></div>}
            {inv.status === "sent" && <div className="flex justify-between font-semibold"><dt>Amount due</dt><dd><Money cents={outstanding} currency={inv.currency} /></dd></div>}
          </dl>
          {inv.currency !== user.base_currency && <p className="mt-2 text-xs text-[#555]">Exchange rate recorded: 1 {inv.currency} = {inv.exchange_rate} {user.base_currency}</p>}
          <footer className="mt-8 border-t border-[#eee] pt-3 text-xs text-[#555]">
            <div className="whitespace-pre-line">{entity.bank_details}</div>
            <div>Payment reference: {inv.number ?? "—"}</div>
            {inv.notes && <div className="mt-2">{inv.notes}</div>}
          </footer>
        </article>
        <aside className="no-print space-y-4">
          {draft && (
            <>
              <Card title="Before sending">
                <form action={updateDraftAction} className="space-y-2">
                  <input type="hidden" name="invoice_id" value={id} />
                  <Field label={`PO number${company.po_required ? " (required)" : ""}`}><input name="po_number" defaultValue={inv.po_number} required={company.po_required} /></Field>
                  {inv.currency !== user.base_currency ? (
                    <Field label={`Exchange rate to ${user.base_currency}`}><input name="exchange_rate" defaultValue={inv.exchange_rate} /></Field>
                  ) : <input type="hidden" name="exchange_rate" defaultValue={inv.exchange_rate} />}
                  <Field label="Notes on invoice"><textarea name="notes" defaultValue={inv.notes} /></Field>
                  <button className={buttonClass("secondary", "sm")}>Save</button>
                </form>
                {company.po_required && !inv.po_number && <p className="mt-2 text-sm text-warning-ink">▲ {company.name} rejects invoices without a PO number.</p>}
              </Card>
              <Card title="Add a line">
                <form action={addLineAction} className="space-y-2">
                  <input type="hidden" name="invoice_id" value={id} />
                  <input name="description" placeholder="Description" required />
                  <div className="grid grid-cols-2 gap-2"><input name="quantity" placeholder="Qty" defaultValue="1" /><input name="unit" placeholder="Unit price" required /></div>
                  <button className={buttonClass("ghost", "sm")}>Add line</button>
                </form>
              </Card>
              <div className="flex gap-2">
                <form action={sendInvoiceAction}><input type="hidden" name="invoice_id" value={id} /><button className={buttonClass("primary")}>Issue and send</button></form>
                <form action={voidInvoiceAction}><input type="hidden" name="invoice_id" value={id} /><button className={buttonClass("ghost")}>Delete draft</button></form>
              </div>
            </>
          )}
          {inv.status === "sent" && (
            <>
              <Card title="Record a payment">
                <form action={recordPaymentAction} className="space-y-2">
                  <input type="hidden" name="invoice_id" value={id} />
                  <input name="amount" defaultValue={(outstanding / 100).toFixed(2)} />
                  <input name="reference" placeholder="EFT reference" />
                  <button className={buttonClass("primary", "sm")}>Record payment</button>
                </form>
              </Card>
              <Card title="Write off">
                <form action={writeOffAction} className="space-y-2">
                  <input type="hidden" name="invoice_id" value={id} />
                  <input name="amount" placeholder="Amount" required />
                  <select name="reason" required defaultValue=""><option value="" disabled>Reason category…</option>{WRITE_OFF_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
                  <input name="note" placeholder="Note" />
                  <button className={buttonClass("danger", "sm")}>Write off</button>
                </form>
              </Card>
              <form action={voidInvoiceAction}><input type="hidden" name="invoice_id" value={id} /><button className={buttonClass("ghost", "sm")}>Void invoice</button></form>
            </>
          )}
          {data.writeOffs.length > 0 && (
            <Card title="Write-offs">{data.writeOffs.map((w, i) => <div key={i} className="text-sm"><Money cents={w.amount_cents} /> · <Badge>{w.reason.replace("_", " ")}</Badge> {w.note}</div>)}</Card>
          )}
        </aside>
      </div>
    </>
  );
}

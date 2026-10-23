import { notFound } from "next/navigation";
import { InvoiceEditor } from "@/components/InvoiceEditor";
import { InvoicePaper, PaperLines, PaperTotals } from "@/components/InvoicePaper";
import { LogoCard } from "@/components/LogoCard";
import { PrintButton } from "@/components/PrintButton";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, Card, Field, Money, PageHeader, StatusBadge, buttonClass } from "@/components/ui";
import { recordPaymentAction, saveAndSendInvoiceAction, saveDraftInvoiceAction, voidInvoiceAction, writeOffAction } from "../../../_actions/billing";
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
      company: (await tx.one<{ name: string; po_required: boolean; billing_email: string; code: string; payment_terms_days: number }>("select name, po_required, billing_email, code, payment_terms_days from companies where id = $1", [inv.company_id]))!,
      entity: (await tx.one<{ legal_name: string; name: string; tax_number: string; registration_number: string; address: string; bank_details: string }>("select * from entities where id = $1", [inv.entity_id]))!,
      writeOffs: await tx.q<{ amount_cents: number; reason: string; note: string; created_at: Date }>("select amount_cents, reason, note, created_at from write_offs where invoice_id = $1", [id]),
    };
  });
  if (!data) notFound();
  const { inv, lines, company, entity } = data;
  const writtenOff = data.writeOffs.reduce((s, w) => s + w.amount_cents, 0);
  const outstanding = inv.total_cents - inv.paid_cents - writtenOff;
  const logoUrl = user.agency_logo_v ? `/api/logo?v=${user.agency_logo_v}` : null;
  const paperBase = { logoUrl, agencyName: user.agency_name, brandColor: user.agency_color, entity };

  if (inv.status === "draft") {
    return (
      <>
        <div className="no-print">
          <PageHeader
            back={{ href: "/app/billing?tab=invoices", label: "Invoices" }}
            title={<span className="flex items-center gap-2">Draft invoice <StatusBadge status="draft" /></span>}
            subtitle={<>{company.name} · edit anything below, then issue. Issued invoices get a number and are locked.</>}
            actions={<PrintButton />}
          />
        </div>
        <InvoiceEditor
          invoiceId={id}
          lines={lines}
          currency={inv.currency}
          baseCurrency={user.base_currency}
          taxLabel={inv.tax_label}
          taxRate={inv.tax_rate}
          poNumber={inv.po_number}
          poRequired={company.po_required}
          dueDate={inv.due_date}
          termsDays={company.payment_terms_days}
          exchangeRate={inv.exchange_rate}
          notes={inv.notes}
          paper={{ ...paperBase, companyName: company.name }}
          saveAction={saveDraftInvoiceAction}
          issueAction={saveAndSendInvoiceAction}
          aside={
            <>
              <LogoCard logoV={user.agency_logo_v} agencyName={user.agency_name} back={`/app/billing/invoices/${id}`} />
              <form action={voidInvoiceAction}>
                <input type="hidden" name="invoice_id" value={id} />
                <SubmitButton confirm="Delete this draft? Its items go back to Ready to bill." className={buttonClass("ghost", "sm") + " w-full !text-critical-ink"}>
                  Delete draft
                </SubmitButton>
              </form>
            </>
          }
        />
      </>
    );
  }

  return (
    <>
      <div className="no-print">
        <PageHeader
          back={{ href: "/app/billing?tab=invoices", label: "Invoices" }}
          title={<span className="flex items-center gap-2">{inv.number} <StatusBadge status={inv.status} /></span>}
          subtitle={company.name}
          actions={<PrintButton />}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] print:block">
        <InvoicePaper
          {...paperBase}
          heading={inv.tax_rate > 0 ? "Tax invoice" : "Invoice"}
          number={inv.number}
          meta={[
            { label: "Issued", value: formatDate(inv.issue_date) },
            { label: "Due", value: formatDate(inv.due_date) },
            ...(inv.po_number ? [{ label: "PO", value: inv.po_number }] : []),
          ]}
          billTo={{ name: company.name }}
          amountDue={inv.status === "sent" ? { cents: outstanding, currency: inv.currency, label: "Amount due" } : undefined}
          stamp={inv.status === "paid" ? { label: "Paid", tone: "good" } : inv.status === "void" ? { label: "Void", tone: "critical" } : undefined}
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
              ...(writtenOff > 0 ? [{ label: "Written off", value: <Money cents={-writtenOff} currency={inv.currency} />, muted: true }] : []),
            ]}
          />
          {inv.currency !== user.base_currency && (
            <p className="mt-3 text-right text-xs text-ink-3">
              Exchange rate recorded: 1 {inv.currency} = {inv.exchange_rate} {user.base_currency}
            </p>
          )}
        </InvoicePaper>
        <aside className="no-print space-y-4">
          {inv.status === "sent" && (
            <>
              <Card title="Record a payment">
                <form action={recordPaymentAction} className="space-y-3">
                  <input type="hidden" name="invoice_id" value={id} />
                  <Field label="Amount"><input name="amount" inputMode="decimal" defaultValue={(outstanding / 100).toFixed(2)} /></Field>
                  <Field label="EFT reference"><input name="reference" /></Field>
                  <SubmitButton className={buttonClass("primary", "sm")}>Record payment</SubmitButton>
                </form>
              </Card>
              <Card title="Write off">
                <form action={writeOffAction} className="space-y-3">
                  <input type="hidden" name="invoice_id" value={id} />
                  <Field label="Amount"><input name="amount" inputMode="decimal" required /></Field>
                  <Field label="Reason"><select name="reason" required defaultValue=""><option value="" disabled>Choose…</option>{WRITE_OFF_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></Field>
                  <Field label="Note"><input name="note" /></Field>
                  <SubmitButton confirm="Write this amount off? It can't be undone." className={buttonClass("danger", "sm")}>Write off</SubmitButton>
                </form>
              </Card>
              <form action={voidInvoiceAction}>
                <input type="hidden" name="invoice_id" value={id} />
                <SubmitButton confirm="Void this invoice? It can't be undone." className={buttonClass("ghost", "sm") + " w-full !text-critical-ink"}>Void invoice</SubmitButton>
              </form>
            </>
          )}
          {inv.status !== "sent" && (
            <Card>
              <p className="text-sm text-ink-2">
                {inv.status === "paid" ? "Paid in full. Issued invoices can't be edited; raise a credit note for any correction." : "This invoice was voided. Its items went back to Ready to bill."}
              </p>
            </Card>
          )}
          {data.writeOffs.length > 0 && (
            <Card title="Write-offs">
              <ul className="space-y-2 text-sm">
                {data.writeOffs.map((w, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <Money cents={w.amount_cents} /> <Badge>{w.reason.replace(/_/g, " ")}</Badge> <span className="text-ink-2">{w.note}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

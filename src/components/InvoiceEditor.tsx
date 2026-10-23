"use client";
import { Plus, Trash, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatMoney, invoiceTotals, toCents } from "@/lib/domain/money";
import { InvoicePaper, PaperTotals, type PaperEntity } from "./InvoicePaper";
import { SubmitButton } from "./SubmitButton";
import { Badge, Card, Field, buttonClass } from "./ui";

export interface EditorLine {
  id: string;
  description: string;
  quantity: number;
  unit_cents: number;
  source_type: string;
}

const F = "invoice-form";

type Row = { key: string; id?: string; description: string; quantity: string; unit: string; source_type: string };

const SOURCE: Record<string, string> = { milestone: "Milestone", retainer_period: "Retainer", change_request: "Change request", time: "Time", cost: "Cost" };

/**
 * Draft invoice editor: the invoice sheet with every line editable in place,
 * live totals, and the details panel beside it. One form; "Save draft" and
 * "Save & issue" both post every field.
 */
export function InvoiceEditor({
  invoiceId,
  lines,
  currency,
  baseCurrency,
  taxLabel,
  taxRate,
  poNumber,
  poRequired,
  dueDate,
  termsDays,
  exchangeRate,
  notes,
  paper,
  saveAction,
  issueAction,
  aside,
}: {
  invoiceId: string;
  lines: EditorLine[];
  currency: string;
  baseCurrency: string;
  taxLabel: string;
  taxRate: number;
  poNumber: string;
  poRequired: boolean;
  dueDate: string | null;
  termsDays: number;
  exchangeRate: number;
  notes: string;
  paper: { logoUrl: string | null; agencyName: string; brandColor: string; entity: PaperEntity; companyName: string };
  saveAction: (fd: FormData) => Promise<void>;
  issueAction: (fd: FormData) => Promise<void>;
  /** Extra cards under the details panel (logo, delete draft), outside the editor form. */
  aside?: ReactNode;
}) {
  const next = useRef(0);
  const toRow = (l: EditorLine): Row => ({ key: l.id, id: l.id, description: l.description, quantity: String(l.quantity), unit: (l.unit_cents / 100).toFixed(2), source_type: l.source_type });
  const [rows, setRows] = useState<Row[]>(() => lines.map(toRow));
  const [tax, setTax] = useState(String(Math.round(taxRate * 10000) / 100));
  const [po, setPo] = useState(poNumber);
  const [dirty, setDirty] = useState(false);
  const descRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const focusKey = useRef<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (focusKey.current) descRefs.current.get(focusKey.current)?.focus();
    focusKey.current = null;
  }, [rows]);

  const qty = (r: Row) => Number(r.quantity.replace(",", ".")) || 0;
  const priced = rows.map((r) => ({ quantity: qty(r), unit_cents: toCents(r.unit) }));
  const rate = (Number(tax.replace(",", ".")) || 0) / 100;
  const totals = invoiceTotals(priced, rate);
  const money = (c: number) => formatMoney(c, currency);
  const change = (key: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const add = () => {
    const key = `new-${next.current++}`;
    focusKey.current = key;
    setRows((rs) => [...rs, { key, description: "", quantity: "1", unit: "", source_type: "manual" }]);
    setDirty(true);
  };
  const remove = (key: string) => {
    setRows((rs) => rs.filter((r) => r.key !== key));
    setDirty(true);
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] print:block">
      <InvoicePaper
        logoUrl={paper.logoUrl}
        agencyName={paper.agencyName}
        brandColor={paper.brandColor}
        entity={paper.entity}
        heading={rate > 0 ? "Tax invoice" : "Invoice"}
        number={<span className="text-ink-3">Draft</span>}
        meta={[
          { label: "Issued", value: "On sending" },
          { label: "Due", value: "Set in details" },
          ...(po ? [{ label: "PO", value: po }] : []),
        ]}
        billTo={{ name: paper.companyName }}
        amountDue={{ cents: totals.total_cents, currency, label: "Total" }}
        footer={
          <>
            <div className="whitespace-pre-line">{paper.entity.bank_details}</div>
            <div>Payment reference: the invoice number, allocated when you issue it.</div>
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                <th className="py-2 pr-2 font-medium">Description</th>
                <th className="w-20 py-2 pl-2 text-right font-medium">Qty</th>
                <th className="w-32 py-2 pl-2 text-right font-medium">Unit price</th>
                <th className="w-32 py-2 pl-2 text-right font-medium">Amount</th>
                <th className="no-print w-10 py-2" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className="group border-b border-line align-top">
                  <td className="py-1.5 pr-2">
                    <input type="hidden" form={F} name="line_id" value={r.id ?? ""} />
                    <input
                      ref={(el) => {
                        if (el) descRefs.current.set(r.key, el);
                        else descRefs.current.delete(r.key);
                      }}
                      form={F}
                      name="line_description"
                      value={r.description}
                      onChange={(e) => change(r.key, { description: e.target.value })}
                      placeholder="What was delivered"
                      aria-label={`Line ${i + 1} description`}
                      className="input-inline field-sm !px-2 print:hidden"
                    />
                    <span className="hidden print:block">{r.description}</span>
                    {SOURCE[r.source_type] && (
                      <div className="no-print mt-0.5 px-2">
                        <Badge tone="info">{SOURCE[r.source_type]}</Badge>
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 pl-2">
                    <input form={F} name="line_quantity" inputMode="decimal" value={r.quantity} onChange={(e) => change(r.key, { quantity: e.target.value })} aria-label={`Line ${i + 1} quantity`} className="input-inline field-sm !px-2 text-right print:hidden" />
                    <span className="tnum hidden text-right print:block">{qty(r)}</span>
                  </td>
                  <td className="py-1.5 pl-2">
                    <input form={F} name="line_unit" inputMode="decimal" value={r.unit} onChange={(e) => change(r.key, { unit: e.target.value })} placeholder="0.00" aria-label={`Line ${i + 1} unit price`} className="input-inline field-sm !px-2 text-right print:hidden" />
                    <span className="tnum hidden text-right print:block">{money(priced[i].unit_cents)}</span>
                  </td>
                  <td className="tnum py-2 pl-2 text-right font-medium">{money(priced[i].unit_cents * priced[i].quantity)}</td>
                  <td className="no-print py-1.5 pl-1 text-right">
                    <button
                      type="button"
                      onClick={() => remove(r.key)}
                      aria-label={`Remove line ${i + 1}${r.description ? `: ${r.description}` : ""}`}
                      title={r.source_type === "time" ? "Remove: this time won't be charged" : r.source_type !== "manual" ? "Remove: the item goes back to Ready to bill" : "Remove line"}
                      className="grid h-7 w-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-critical/10 hover:text-critical-ink pointer-coarse:h-11 pointer-coarse:w-11"
                    >
                      <Trash aria-hidden size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={add} className={buttonClass("ghost", "sm") + " no-print mt-2 !text-brand"}>
          <Plus aria-hidden size={14} weight="bold" /> Add line
        </button>
        <PaperTotals
          rows={[
            { label: "Subtotal", value: money(totals.subtotal_cents) },
            { label: `${taxLabel} ${Math.round(rate * 1000) / 10}%`, value: money(totals.tax_cents), muted: true },
            { label: "Total", value: money(totals.total_cents), strong: true },
          ]}
        />
      </InvoicePaper>

      <div className="no-print space-y-4">
        {/* Only the details panel is inside the form; the sheet's line fields join it via form="invoice-form",
            so the aside's own forms (logo, delete) aren't nested. */}
        <form id={F} action={saveAction} onChange={() => setDirty(true)} className="space-y-4">
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <Card title="Invoice details" actions={dirty ? <Badge tone="warning" dot>Unsaved</Badge> : <Badge tone="good" dot>Saved</Badge>}>
          <div className="space-y-3">
            <Field label={`PO number${poRequired ? " (required)" : ""}`}>
              <input name="po_number" value={po} onChange={(e) => setPo(e.target.value)} />
            </Field>
            {poRequired && !po.trim() && (
              <p className="flex items-start gap-1.5 text-xs text-warning-ink">
                <WarningCircle aria-hidden size={14} weight="fill" className="mt-px shrink-0" /> This client rejects invoices without a PO number.
              </p>
            )}
            <Field label="Due date" hint={`Blank = ${termsDays} days from the issue date (client terms).`}>
              <input type="date" name="due_date" defaultValue={dueDate ?? ""} />
            </Field>
            <Field label={`${taxLabel} rate %`} hint="Use 0 for zero-rated exports.">
              <input name="tax_rate" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
            </Field>
            {currency !== baseCurrency ? (
              <Field label={`Exchange rate to ${baseCurrency}`}>
                <input name="exchange_rate" inputMode="decimal" defaultValue={exchangeRate} />
              </Field>
            ) : (
              <input type="hidden" name="exchange_rate" value={exchangeRate} />
            )}
            <Field label="Notes on the invoice" hint="Printed in the footer.">
              <textarea name="notes" defaultValue={notes} />
            </Field>
          </div>
        </Card>
        <Card>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-2">{rows.length} {rows.length === 1 ? "line" : "lines"}</dt>
              <dd className="tnum">{money(totals.subtotal_cents)}</dd>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <dt>Total</dt>
              <dd className="tnum">{money(totals.total_cents)}</dd>
            </div>
          </dl>
          <div className="mt-4 grid gap-2">
            <SubmitButton formAction={issueAction} confirm="Issue this invoice? It gets a number, is emailed to the client and can no longer be edited." className={buttonClass("primary")}>
              Save &amp; issue
            </SubmitButton>
            <SubmitButton className={buttonClass("secondary")} onClick={() => setDirty(false)}>
              Save draft
            </SubmitButton>
          </div>
        </Card>
        </form>
        {aside}
      </div>
    </div>
  );
}

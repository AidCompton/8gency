import type { Tx } from "../db";
import { recordPayment } from "../services/billing";
import { api, upsertObject, type Conn } from "./connections";
import { qboBase } from "./identify";

// Issued invoices go to the accounting system; payments recorded there come
// back and settle the invoice here. Matching is by the pushed invoice's id.

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Inv {
  id: string;
  number: string;
  issue_date: string;
  due_date: string;
  currency: string;
  po_number: string;
  tax_rate: number;
  total_cents: number;
  paid_cents: number;
  company_name: string;
  billing_email: string;
}

const money = (cents: number) => Math.round(cents) / 100;

/** Issued since the connection was made (or the chosen start date) and not pushed yet. */
const unpushed = (tx: Tx, conn: Conn) =>
  tx.q<Inv>(
    `select i.id, i.number, i.issue_date::text, i.due_date::text, i.currency, i.po_number, i.tax_rate::float, i.total_cents, i.paid_cents, co.name as company_name, co.billing_email
       from invoices i join companies co on co.id = i.company_id
      where i.status in ('sent','paid') and i.sent_at >= coalesce(($2)::timestamptz, $3)
        and not exists (select 1 from external_objects o where o.connection_id = $1 and o.kind = 'invoice' and o.matched_id = i.id)
      order by i.sent_at limit 25`,
    [conn.id, conn.settings.push_from ?? null, conn.created_at],
  );

const linesOf = (tx: Tx, id: string) =>
  tx.q<{ description: string; quantity: number; unit_cents: number; amount_cents: number }>("select description, quantity::float, unit_cents, amount_cents from invoice_lines where invoice_id = $1 order by sort", [id]);

/** Pushed invoices still unpaid here, with their id in the accounting system. */
const open = (tx: Tx, conn: Conn) =>
  tx.q<{ id: string; external_id: string; total_cents: number; paid_cents: number; written_off: number }>(
    `select i.id, o.external_id, i.total_cents, i.paid_cents, coalesce((select sum(amount_cents) from write_offs w where w.invoice_id = i.id), 0)::bigint as written_off
       from external_objects o join invoices i on i.id = o.matched_id
      where o.connection_id = $1 and o.kind = 'invoice' and i.status = 'sent'`,
    [conn.id],
  );

/** Bring 8gency's paid amount up to the share the accounting system says is paid. */
async function settle(tx: Tx, inv: { id: string; total_cents: number; paid_cents: number; written_off: number }, paidShare: number, source: string) {
  const target = Math.round(Math.min(1, paidShare) * inv.total_cents);
  const diff = Math.min(target - inv.paid_cents, inv.total_cents - inv.paid_cents - inv.written_off);
  if (diff <= 0) return false;
  await recordPayment(tx, inv.id, diff, source);
  return true;
}

// ── Xero ────────────────────────────────────────────────────────────────

const XERO = "https://api.xero.com/api.xro/2.0";

export async function syncXero(tx: Tx, conn: Conn) {
  const headers = { "xero-tenant-id": conn.external_account_id };
  const s = conn.settings;
  let pushed = 0;
  for (const inv of await unpushed(tx, conn)) {
    const lines = await linesOf(tx, inv.id);
    const r = await api(tx, conn, `${XERO}/Invoices`, {
      method: "POST",
      headers,
      json: {
        Invoices: [
          {
            Type: "ACCREC",
            Contact: { Name: inv.company_name, ...(inv.billing_email ? { EmailAddress: inv.billing_email } : {}) },
            InvoiceNumber: inv.number,
            Reference: inv.po_number || undefined,
            Date: inv.issue_date,
            DueDate: inv.due_date,
            CurrencyCode: inv.currency,
            Status: "AUTHORISED",
            LineAmountTypes: "Exclusive",
            LineItems: lines.map((l) => ({
              Description: l.description,
              Quantity: l.quantity,
              UnitAmount: money(l.unit_cents),
              AccountCode: s.account_code || "200",
              TaxType: inv.tax_rate > 0 ? s.tax_type || "OUTPUT" : s.zero_tax_type || "NONE",
            })),
          },
        ],
      },
    });
    const x = r.Invoices?.[0];
    await upsertObject(tx, conn, { kind: "invoice", externalId: x.InvoiceID, on: inv.issue_date, payload: { number: inv.number, total: x.Total }, matchedType: "invoice", matchedId: inv.id });
    await tx.audit("connector.invoice_pushed", "invoice", inv.id, undefined, { to: "Xero", number: inv.number });
    pushed++;
  }
  let paid = 0;
  const openInv = await open(tx, conn);
  for (let i = 0; i < openInv.length; i += 40) {
    const batch = openInv.slice(i, i + 40);
    const r = await api(tx, conn, `${XERO}/Invoices?IDs=${batch.map((b) => b.external_id).join(",")}&summaryOnly=true`, { headers });
    for (const x of r.Invoices ?? []) {
      const inv = batch.find((b) => b.external_id === x.InvoiceID);
      if (inv && x.Total > 0 && (await settle(tx, inv, x.Status === "PAID" ? 1 : x.AmountPaid / x.Total, "Paid in Xero"))) paid++;
    }
  }
  return `${pushed} invoices sent to Xero, ${paid} payments brought back`;
}

// ── QuickBooks Online ────────────────────────────────────────────────────

export async function syncQuickBooks(tx: Tx, conn: Conn) {
  const base = `${qboBase()}/v3/company/${conn.external_account_id}`;
  const query = (q: string) => api(tx, conn, `${base}/query?minorversion=75&query=${encodeURIComponent(q)}`);
  const s = conn.settings;
  let pushed = 0;
  for (const inv of await unpushed(tx, conn)) {
    const found = await query(`select Id from Customer where DisplayName = '${inv.company_name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
    const customer =
      found.QueryResponse?.Customer?.[0]?.Id ??
      (await api(tx, conn, `${base}/customer?minorversion=75`, { method: "POST", json: { DisplayName: inv.company_name, ...(inv.billing_email ? { PrimaryEmailAddr: { Address: inv.billing_email } } : {}) } })).Customer.Id;
    const lines = await linesOf(tx, inv.id);
    const r = await api(tx, conn, `${base}/invoice?minorversion=75`, {
      method: "POST",
      json: {
        CustomerRef: { value: customer },
        DocNumber: inv.number,
        TxnDate: inv.issue_date,
        DueDate: inv.due_date,
        ...(inv.po_number ? { PrivateNote: `PO ${inv.po_number}` } : {}),
        Line: lines.map((l) => ({
          Amount: money(l.amount_cents),
          Description: l.description,
          DetailType: "SalesItemLineDetail",
          SalesItemLineDetail: { ItemRef: { value: String(s.item_id || "1") }, Qty: l.quantity, UnitPrice: money(l.unit_cents), ...(s.tax_code ? { TaxCodeRef: { value: String(s.tax_code) } } : {}) },
        })),
      },
    });
    await upsertObject(tx, conn, { kind: "invoice", externalId: r.Invoice.Id, on: inv.issue_date, payload: { number: inv.number, total: r.Invoice.TotalAmt }, matchedType: "invoice", matchedId: inv.id });
    await tx.audit("connector.invoice_pushed", "invoice", inv.id, undefined, { to: "QuickBooks", number: inv.number });
    pushed++;
  }
  let paid = 0;
  const openInv = await open(tx, conn);
  for (let i = 0; i < openInv.length; i += 40) {
    const batch = openInv.slice(i, i + 40);
    const r = await query(`select Id, TotalAmt, Balance from Invoice where Id in (${batch.map((b) => `'${b.external_id.replace(/\D/g, "")}'`).join(",")})`);
    for (const x of r.QueryResponse?.Invoice ?? []) {
      const inv = batch.find((b) => b.external_id === x.Id);
      if (inv && x.TotalAmt > 0 && (await settle(tx, inv, (x.TotalAmt - x.Balance) / x.TotalAmt, "Paid in QuickBooks"))) paid++;
    }
  }
  return `${pushed} invoices sent to QuickBooks, ${paid} payments brought back`;
}

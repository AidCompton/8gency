"use server";
import { act, num, str } from "@/lib/actions";
import { requireUser, tenant } from "@/lib/auth";
import { toCents } from "@/lib/domain/money";
import { assertCan } from "@/lib/permissions";
import { createInvoice, recordPayment, saveDraftInvoice, sendInvoice, voidInvoice, writeOff, type DraftInvoiceEdit } from "@/lib/services/billing";

export async function createInvoiceAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "billing");
  await act("/app/billing", () =>
    tenant(user, async (tx) => {
      const keys = fd.getAll("item").map(String);
      const id = await createInvoice(tx, str(fd, "company_id"), keys);
      return `/app/billing/invoices/${id}`;
    }),
  );
}

/** The editor posts parallel line_* arrays in display order; blank new rows are dropped by the service. */
function draftEdit(fd: FormData): DraftInvoiceEdit {
  const ids = fd.getAll("line_id").map(String);
  const qty = fd.getAll("line_quantity").map(String);
  const unit = fd.getAll("line_unit").map(String);
  const lines = fd.getAll("line_description").map((d, i) => ({
    id: ids[i] || undefined,
    description: String(d),
    quantity: Number((qty[i] ?? "").replace(",", ".").trim() || "NaN"),
    unit_cents: toCents(unit[i] ?? ""),
  }));
  return {
    lines,
    po_number: str(fd, "po_number"),
    notes: String(fd.get("notes") ?? ""),
    due_date: str(fd, "due_date") || null,
    tax_rate: num(fd, "tax_rate") / 100,
    exchange_rate: num(fd, "exchange_rate") || 1,
  };
}

export async function saveDraftInvoiceAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "billing");
  const id = str(fd, "invoice_id");
  await act(`/app/billing/invoices/${id}`, () => tenant(user, (tx) => saveDraftInvoice(tx, id, draftEdit(fd))), "Draft saved.");
}

/**
 * Save, then issue. Two transactions on purpose: if issuing is refused (say a
 * missing PO number) the edits are still saved and the error explains why.
 */
export async function saveAndSendInvoiceAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "billing");
  const id = str(fd, "invoice_id");
  await act(
    `/app/billing/invoices/${id}`,
    async () => {
      await tenant(user, (tx) => saveDraftInvoice(tx, id, draftEdit(fd)));
      await tenant(user, (tx) => sendInvoice(tx, id));
    },
    "Invoice issued and emailed to the client's billing contacts.",
  );
}

export async function sendInvoiceAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "billing");
  const id = str(fd, "invoice_id");
  await act(`/app/billing/invoices/${id}`, () => tenant(user, async (tx) => void (await sendInvoice(tx, id))), "Invoice issued and emailed to the client's billing contacts.");
}

export async function voidInvoiceAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "billing");
  const id = str(fd, "invoice_id");
  await act("/app/billing?tab=invoices", () => tenant(user, (tx) => voidInvoice(tx, id)), "Invoice voided; its items are back in the ready-to-bill queue.");
}

export async function recordPaymentAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "billing");
  const id = str(fd, "invoice_id");
  await act(`/app/billing/invoices/${id}`, () => tenant(user, (tx) => recordPayment(tx, id, toCents(str(fd, "amount")), str(fd, "reference"))), "Payment recorded.");
}

export async function writeOffAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "billing");
  const id = str(fd, "invoice_id");
  await act(`/app/billing/invoices/${id}`, () => tenant(user, (tx) => writeOff(tx, { invoice_id: id, amount_cents: toCents(str(fd, "amount")), reason: str(fd, "reason"), note: str(fd, "note") })), "Write-off recorded.");
}

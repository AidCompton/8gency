"use server";
import { act, num, str } from "@/lib/actions";
import { requireUser, tenant } from "@/lib/auth";
import { toCents } from "@/lib/domain/money";
import { assertCan } from "@/lib/permissions";
import { addManualLine, createInvoice, recordPayment, sendInvoice, updateDraft, voidInvoice, writeOff } from "@/lib/services/billing";

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

export async function updateDraftAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "billing");
  const id = str(fd, "invoice_id");
  await act(`/app/billing/invoices/${id}`, () => tenant(user, (tx) => updateDraft(tx, id, { po_number: str(fd, "po_number"), notes: str(fd, "notes"), exchange_rate: num(fd, "exchange_rate") })), "Saved.");
}

export async function addLineAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "billing");
  const id = str(fd, "invoice_id");
  await act(`/app/billing/invoices/${id}`, () => tenant(user, (tx) => addManualLine(tx, id, { description: str(fd, "description"), quantity: num(fd, "quantity") || 1, unit_cents: toCents(str(fd, "unit")) })));
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

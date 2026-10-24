import { createHash, createHmac } from "node:crypto";
import type { Tx } from "../db";
import { recordPayment } from "../services/billing";
import { appUrl, UserError } from "../services/core";
import { safeEqual } from "../vault";
import { activeConnection, readSecret, upsertObject, type Conn } from "./connections";

// A pay-now button on hub invoices. The provider's signed webhook (not the
// browser coming back) is what records the payment, once per transaction.

/* eslint-disable @typescript-eslint/no-explicit-any */
export const PAY_PROVIDERS = ["payfast", "paystack", "stripe"] as const;
export type PayProvider = (typeof PAY_PROVIDERS)[number];

export async function payOptions(tx: Tx) {
  const rows = await tx.q<{ provider: PayProvider }>("select provider from connections where provider = any($1) and status = 'active' order by provider", [PAY_PROVIDERS as unknown as string[]]);
  return rows.map((r) => r.provider);
}

export const webhookUrl = (provider: string, agencyId: string) => appUrl(`/api/connectors/${provider}/webhook?a=${agencyId}`);

/** PayFast's signature: MD5 of the fields in order (URL-encoded, spaces as +), then the passphrase. */
export function payfastSignature(fields: [string, string][], passphrase: string) {
  const enc = (v: string) => encodeURIComponent(v.trim()).replace(/%20/g, "+").replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const parts = fields.filter(([, v]) => v !== "").map(([k, v]) => `${k}=${enc(v)}`);
  if (passphrase) parts.push(`passphrase=${enc(passphrase)}`);
  return createHash("md5").update(parts.join("&")).digest("hex");
}

/** Start a payment for what's left on an invoice and return where to send the client. */
export async function startCheckout(tx: Tx, provider: PayProvider, invoiceId: string, contact: { name: string; email: string }, returnUrl: string): Promise<string> {
  const conn = await activeConnection(tx, provider);
  if (!conn) throw new UserError("That payment option isn't available.");
  const inv = await tx.one<{ number: string; currency: string; total_cents: number; paid_cents: number; status: string }>("select number, currency, total_cents, paid_cents, status from invoices where id = $1", [invoiceId]);
  if (!inv || inv.status !== "sent") throw new UserError("This invoice can't be paid online.");
  const due = inv.total_cents - inv.paid_cents;
  if (due <= 0) throw new UserError("Nothing is owing on this invoice.");
  const s = await readSecret(tx, conn.id);
  const meta = { agency_id: tx.agencyId, invoice_id: invoiceId };

  if (provider === "stripe") {
    const f = new URLSearchParams({
      mode: "payment",
      success_url: `${returnUrl}?paid=1`,
      cancel_url: returnUrl,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": inv.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(due),
      "line_items[0][price_data][product_data][name]": `Invoice ${inv.number}`,
      "metadata[agency_id]": meta.agency_id,
      "metadata[invoice_id]": meta.invoice_id,
      ...(contact.email ? { customer_email: contact.email } : {}),
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { authorization: `Bearer ${s.secret_key}` }, body: f });
    const r: any = await res.json();
    if (!res.ok) throw new UserError(`Card payments are unavailable right now (Stripe: ${r.error?.message ?? res.status}). Please pay by EFT.`);
    return r.url;
  }

  if (provider === "paystack") {
    if (!contact.email) throw new UserError("Paystack needs an email address for the payer. Ask the agency to add yours.");
    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { authorization: `Bearer ${s.secret_key}`, "content-type": "application/json" },
      body: JSON.stringify({ email: contact.email, amount: due, currency: inv.currency, callback_url: `${returnUrl}?paid=1`, metadata: meta }),
    });
    const r: any = await res.json();
    if (!res.ok || !r.status) throw new UserError(`Online payment is unavailable right now (Paystack: ${r.message ?? res.status}). Please pay by EFT.`);
    return r.data.authorization_url;
  }

  // PayFast: a signed redirect to their hosted payment page.
  const [first, ...rest] = contact.name.trim().split(/\s+/);
  const fields: [string, string][] = [
    ["merchant_id", String(s.merchant_id)],
    ["merchant_key", String(s.merchant_key)],
    ["return_url", `${returnUrl}?paid=1`],
    ["cancel_url", returnUrl],
    ["notify_url", webhookUrl("payfast", tx.agencyId)],
    ["name_first", first ?? ""],
    ["name_last", rest.join(" ")],
    ["email_address", contact.email],
    ["m_payment_id", invoiceId],
    ["amount", (due / 100).toFixed(2)],
    ["item_name", `Invoice ${inv.number}`],
    ["custom_str1", tx.agencyId],
  ];
  const q = new URLSearchParams(fields.filter(([, v]) => v !== ""));
  q.set("signature", payfastSignature(fields, String(s.passphrase ?? "")));
  return `https://${s.sandbox ? "sandbox" : "www"}.payfast.co.za/eng/process?${q}`;
}

/** Record a confirmed payment once, however many times the provider retries the webhook. */
async function paid(tx: Tx, conn: Conn, txnId: string, invoiceId: string, cents: number, currency: string, label: string) {
  const inv = await tx.one<{ currency: string; status: string }>("select currency, status from invoices where id = $1", [invoiceId]);
  if (!inv) return "unknown invoice";
  if (currency.toUpperCase() !== inv.currency.toUpperCase()) return "currency mismatch";
  const o = await upsertObject(tx, conn, { kind: "payment", externalId: txnId, payload: { cents, currency, label }, matchedType: "invoice", matchedId: invoiceId });
  if (!o.inserted) return "already recorded";
  if (inv.status !== "sent") return "invoice not open";
  await recordPayment(tx, invoiceId, cents, `${label} ${txnId}`);
  return "recorded";
}

/** Verify and apply a payment provider's webhook. Returns a short status for the response body. */
export async function handlePaymentWebhook(tx: Tx, provider: PayProvider, req: { raw: string; headers: Headers }): Promise<{ status: number; body: string }> {
  const conn = await activeConnection(tx, provider);
  if (!conn) return { status: 404, body: "not connected" };
  const s = await readSecret(tx, conn.id);

  if (provider === "stripe") {
    const sig = Object.fromEntries((req.headers.get("stripe-signature") ?? "").split(",").map((kv) => kv.split("=") as [string, string]));
    const want = createHmac("sha256", String(s.webhook_secret ?? "")).update(`${sig.t}.${req.raw}`).digest("hex");
    if (!sig.t || !sig.v1 || !safeEqual(want, sig.v1) || Math.abs(Date.now() / 1000 - Number(sig.t)) > 600) return { status: 400, body: "bad signature" };
    const e = JSON.parse(req.raw);
    if (e.type !== "checkout.session.completed" || e.data.object.payment_status !== "paid") return { status: 200, body: "ignored" };
    const o = e.data.object;
    if (o.metadata?.agency_id !== tx.agencyId) return { status: 200, body: "other agency" };
    return { status: 200, body: await paid(tx, conn, o.id, o.metadata.invoice_id, o.amount_total, o.currency, "Stripe") };
  }

  if (provider === "paystack") {
    const want = createHmac("sha512", String(s.secret_key ?? "")).update(req.raw).digest("hex");
    if (!safeEqual(want, req.headers.get("x-paystack-signature") ?? "")) return { status: 400, body: "bad signature" };
    const e = JSON.parse(req.raw);
    if (e.event !== "charge.success" || e.data?.status !== "success") return { status: 200, body: "ignored" };
    const m = typeof e.data.metadata === "string" ? JSON.parse(e.data.metadata) : e.data.metadata;
    if (m?.agency_id !== tx.agencyId) return { status: 200, body: "other agency" };
    return { status: 200, body: await paid(tx, conn, String(e.data.reference), m.invoice_id, e.data.amount, e.data.currency, "Paystack") };
  }

  // PayFast ITN: check the signature, then ask PayFast to confirm the data is theirs.
  const fields = [...new URLSearchParams(req.raw).entries()];
  const given = fields.find(([k]) => k === "signature")?.[1] ?? "";
  const unsigned = fields.filter(([k]) => k !== "signature");
  if (!safeEqual(payfastSignature(unsigned, String(s.passphrase ?? "")), given)) return { status: 400, body: "bad signature" };
  const f = Object.fromEntries(fields);
  if (f.merchant_id !== String(s.merchant_id) || f.custom_str1 !== tx.agencyId) return { status: 400, body: "wrong merchant" };
  const check = await fetch(`https://${s.sandbox ? "sandbox" : "www"}.payfast.co.za/eng/query/validate`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(unsigned).toString(),
  });
  if ((await check.text()).trim() !== "VALID") return { status: 400, body: "not validated" };
  if (f.payment_status !== "COMPLETE") return { status: 200, body: "ignored" };
  return { status: 200, body: await paid(tx, conn, f.pf_payment_id, f.m_payment_id, Math.round(Number(f.amount_gross) * 100), "ZAR", "PayFast") };
}

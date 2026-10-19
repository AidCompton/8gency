import type { Tx } from "../db";
import { addDays, daysBetween, formatShort, todayIn } from "../domain/dates";
import { formatMoney, invoiceTotals, lineAmount } from "../domain/money";
import { agencySettings, appUrl, ensureHubToken, notify, queueMessage, UserError } from "./core";

export interface BillableItem {
  key: string; // `${source_type}:${source_id}`
  source_type: "milestone" | "retainer_period" | "change_request" | "time" | "cost";
  source_id: string;
  company_id: string;
  company_name: string;
  job_id: string | null;
  job_number: string | null;
  description: string;
  quantity: number;
  unit_cents: number;
  amount_cents: number;
  ready_since: string;
  age_days: number;
  overdue: boolean;
  po_required: boolean;
}

/**
 * The "ready to bill" queue (M15): completed milestones, retainer periods,
 * approved change requests, unbilled T&M time and re-billable costs. Anything
 * that has waited longer than the agency's limit is flagged (FN-01).
 */
export async function readyToBill(tx: Tx, companyId?: string): Promise<BillableItem[]> {
  const settings = await agencySettings(tx);
  const today = todayIn(settings.timezone);
  const c = companyId ?? null;
  const rows: Omit<BillableItem, "key" | "age_days" | "overdue">[] = [];

  rows.push(
    ...(await tx.q<Omit<BillableItem, "key" | "age_days" | "overdue">>(
      `select 'milestone' as source_type, m.id as source_id, j.company_id, co.name as company_name, j.id as job_id, j.number as job_number,
              j.number || ' ' || j.name || ': ' || m.name as description, 1 as quantity, m.amount_cents as unit_cents, m.amount_cents,
              (m.completed_at at time zone a.timezone)::date::text as ready_since, co.po_required
         from milestones m join jobs j on j.id = m.job_id join companies co on co.id = j.company_id join agencies a on a.id = m.agency_id
        where m.status = 'complete' and m.amount_cents > 0 and ($1::uuid is null or j.company_id = $1)`,
      [c],
    )),
  );

  rows.push(
    ...(await tx.q<Omit<BillableItem, "key" | "age_days" | "overdue">>(
      `select 'retainer_period' as source_type, p.id as source_id, r.company_id, co.name as company_name, null as job_id, null as job_number,
              r.name || ' retainer: ' || to_char(p.starts_on, 'DD Mon') || ' – ' || to_char(p.ends_on, 'DD Mon YYYY') as description,
              1 as quantity, p.fee_cents as unit_cents, p.fee_cents as amount_cents,
              (case when r.billing_timing = 'advance' then p.starts_on else p.ends_on + 1 end)::text as ready_since, co.po_required
         from retainer_periods p join retainers r on r.id = p.retainer_id join companies co on co.id = r.company_id
        where p.fee_cents > 0
          and (case when r.billing_timing = 'advance' then p.starts_on <= $2 else p.ends_on < $2 end)
          and not exists (select 1 from invoice_lines l join invoices i on i.id = l.invoice_id
                           where l.source_type = 'retainer_period' and l.source_id = p.id and i.status <> 'void')
          and ($1::uuid is null or r.company_id = $1)`,
      [c, today],
    )),
  );

  rows.push(
    ...(await tx.q<Omit<BillableItem, "key" | "age_days" | "overdue">>(
      `select 'change_request' as source_type, cr.id as source_id, cr.company_id, co.name as company_name, cr.job_id, j.number as job_number,
              'Change request: ' || cr.title as description, 1 as quantity, cr.price_cents as unit_cents, cr.price_cents as amount_cents,
              (cr.decided_at at time zone a.timezone)::date::text as ready_since, co.po_required
         from change_requests cr join companies co on co.id = cr.company_id left join jobs j on j.id = cr.job_id join agencies a on a.id = cr.agency_id
        where cr.status = 'approved' and cr.price_cents > 0
          and not exists (select 1 from invoice_lines l join invoices i on i.id = l.invoice_id
                           where l.source_type = 'change_request' and l.source_id = cr.id and i.status <> 'void')
          and ($1::uuid is null or cr.company_id = $1)`,
      [c],
    )),
  );

  // T&M time, grouped per job and rate so each line is one rate × hours.
  rows.push(
    ...(await tx.q<Omit<BillableItem, "key" | "age_days" | "overdue">>(
      `select 'time' as source_type, j.id as source_id, j.company_id, co.name as company_name, j.id as job_id, j.number as job_number,
              j.number || ' ' || j.name || ': time to ' || to_char(max(te.work_date), 'DD Mon') as description,
              round(sum(te.hours)::numeric, 2) as quantity,
              round(sum(te.hours * te.rate_cents) / nullif(sum(te.hours),0)) as unit_cents,
              round(sum(te.hours * te.rate_cents)) as amount_cents,
              min(te.work_date)::text as ready_since, co.po_required
         from time_entries te join jobs j on j.id = te.job_id join companies co on co.id = j.company_id
        where j.billing_model = 'tm' and te.category = 'billable' and te.invoice_line_id is null and not te.out_of_scope
          and ($1::uuid is null or j.company_id = $1)
        group by j.id, j.company_id, co.name, j.number, j.name, co.po_required`,
      [c],
    )),
  );

  rows.push(
    ...(await tx.q<Omit<BillableItem, "key" | "age_days" | "overdue">>(
      `select 'cost' as source_type, k.id as source_id, j.company_id, co.name as company_name, j.id as job_id, j.number as job_number,
              k.description || coalesce(' (' || nullif(k.supplier,'') || ')', '') || ' incl. ' || round(k.markup*100) || '% markup' as description,
              1 as quantity, round(k.amount_cents * (1 + k.markup)) as unit_cents, round(k.amount_cents * (1 + k.markup)) as amount_cents,
              k.incurred_on::text as ready_since, co.po_required
         from costs k join jobs j on j.id = k.job_id join companies co on co.id = j.company_id
        where k.rebillable and k.invoice_line_id is null and ($1::uuid is null or j.company_id = $1)`,
      [c],
    )),
  );

  return rows
    .map((r) => {
      const age = Math.max(0, daysBetween(r.ready_since, today));
      return { ...r, key: `${r.source_type}:${r.source_id}`, age_days: age, overdue: age > settings.bill_within_days };
    })
    .sort((a, b) => b.age_days - a.age_days);
}

/** Build a draft invoice from ready-to-bill items for one client. */
export async function createInvoice(tx: Tx, companyId: string, itemKeys: string[], extra: { po_number?: string; notes?: string } = {}) {
  const items = (await readyToBill(tx, companyId)).filter((i) => itemKeys.includes(i.key));
  if (!items.length) throw new UserError("Select at least one item to bill.");
  const company = await tx.one<{ entity_id: string | null; currency: string }>("select entity_id, currency from companies where id = $1", [companyId]);
  const entity = await tx.one<{ id: string; tax_label: string; tax_rate: number; currency: string }>(
    "select id, tax_label, tax_rate, currency from entities where id = coalesce($1, (select id from entities where is_default limit 1))",
    [company?.entity_id ?? null],
  );
  if (!entity) throw new UserError("Set up a billing entity in Settings first.");
  const inv = await tx.one<{ id: string }>(
    `insert into invoices (agency_id, entity_id, company_id, currency, tax_label, tax_rate, po_number, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [tx.agencyId, entity.id, companyId, company?.currency ?? entity.currency, entity.tax_label, entity.tax_rate, extra.po_number ?? "", extra.notes ?? ""],
  );
  let sort = 0;
  for (const item of items) {
    const line = await tx.one<{ id: string }>(
      `insert into invoice_lines (agency_id, invoice_id, job_id, description, quantity, unit_cents, amount_cents, source_type, source_id, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [tx.agencyId, inv!.id, item.job_id, item.description, item.quantity, item.unit_cents, item.amount_cents, item.source_type, item.source_id, sort++],
    );
    if (item.source_type === "milestone") await tx.q("update milestones set status = 'invoiced' where id = $1", [item.source_id]);
    if (item.source_type === "time")
      await tx.q(
        "update time_entries set invoice_line_id = $2 where job_id = $1 and category = 'billable' and invoice_line_id is null and not out_of_scope",
        [item.source_id, line!.id],
      );
    if (item.source_type === "cost") await tx.q("update costs set invoice_line_id = $2 where id = $1", [item.source_id, line!.id]);
  }
  await recalcInvoice(tx, inv!.id);
  await tx.audit("invoice.drafted", "invoice", inv!.id, undefined, { items: items.map((i) => i.key) });
  return inv!.id;
}

export async function recalcInvoice(tx: Tx, invoiceId: string) {
  const inv = await tx.one<{ tax_rate: number }>("select tax_rate from invoices where id = $1", [invoiceId]);
  const lines = await tx.q<{ id: string; quantity: number; unit_cents: number }>("select id, quantity, unit_cents from invoice_lines where invoice_id = $1", [invoiceId]);
  for (const l of lines) await tx.q("update invoice_lines set amount_cents = $2 where id = $1", [l.id, lineAmount(l)]);
  const t = invoiceTotals(lines, inv!.tax_rate);
  await tx.q("update invoices set subtotal_cents = $2, tax_cents = $3, total_cents = $4 where id = $1", [invoiceId, t.subtotal_cents, t.tax_cents, t.total_cents]);
}

export async function addManualLine(tx: Tx, invoiceId: string, line: { description: string; quantity: number; unit_cents: number; job_id?: string | null }) {
  await assertDraft(tx, invoiceId);
  if (!line.description.trim()) throw new UserError("Describe the line.");
  await tx.q(
    `insert into invoice_lines (agency_id, invoice_id, job_id, description, quantity, unit_cents, amount_cents, source_type, sort)
     values ($1,$2,$3,$4,$5,$6,$7,'manual',999)`,
    [tx.agencyId, invoiceId, line.job_id ?? null, line.description.trim(), line.quantity, line.unit_cents, lineAmount(line)],
  );
  await recalcInvoice(tx, invoiceId);
}

async function assertDraft(tx: Tx, invoiceId: string) {
  const inv = await tx.one<{ status: string }>("select status from invoices where id = $1", [invoiceId]);
  if (inv?.status !== "draft") throw new UserError("Only draft invoices can be changed. Issue a credit note for sent invoices.");
}

export async function updateDraft(tx: Tx, invoiceId: string, f: { po_number: string; notes: string; exchange_rate: number }) {
  await assertDraft(tx, invoiceId);
  await tx.q("update invoices set po_number = $2, notes = $3, exchange_rate = $4 where id = $1", [invoiceId, f.po_number.trim(), f.notes, f.exchange_rate || 1]);
}

/** Release the sources of a draft back to the ready-to-bill queue. */
export async function voidInvoice(tx: Tx, invoiceId: string) {
  const inv = await tx.one<{ status: string; number: string | null }>("select status, number from invoices where id = $1", [invoiceId]);
  if (!inv) return;
  if (inv.status === "paid") throw new UserError("A paid invoice can't be voided. Use a credit note.");
  const lines = await tx.q<{ id: string; source_type: string; source_id: string | null }>("select id, source_type, source_id from invoice_lines where invoice_id = $1", [invoiceId]);
  for (const l of lines) {
    if (l.source_type === "milestone") await tx.q("update milestones set status = 'complete' where id = $1", [l.source_id]);
    if (l.source_type === "time") await tx.q("update time_entries set invoice_line_id = null where invoice_line_id = $1", [l.id]);
    if (l.source_type === "cost") await tx.q("update costs set invoice_line_id = null where invoice_line_id = $1", [l.id]);
  }
  if (inv.status === "draft") {
    await tx.q("delete from invoices where id = $1", [invoiceId]);
    await tx.audit("invoice.draft_deleted", "invoice", invoiceId);
  } else {
    await tx.q("update invoices set status = 'void' where id = $1", [invoiceId]);
    await tx.audit("invoice.voided", "invoice", invoiceId, { status: inv.status, number: inv.number }, { status: "void" });
  }
}

/**
 * Issue a tax invoice: allocate the entity's next number, enforce PO numbers
 * for clients that need them (ON-07), lock billed time and send it.
 */
export async function sendInvoice(tx: Tx, invoiceId: string) {
  const inv = await tx.one<{ status: string; company_id: string; entity_id: string; po_number: string; total_cents: number; currency: string }>(
    "select status, company_id, entity_id, po_number, total_cents, currency from invoices where id = $1",
    [invoiceId],
  );
  if (!inv) throw new UserError("Invoice not found.");
  if (inv.status !== "draft") throw new UserError("Already sent.");
  const company = await tx.one<{ name: string; po_required: boolean; payment_terms_days: number; billing_email: string }>(
    "select name, po_required, payment_terms_days, billing_email from companies where id = $1",
    [inv.company_id],
  );
  if (company!.po_required && !inv.po_number.trim()) throw new UserError(`${company!.name} requires a PO number on every invoice. Add it before sending.`);
  if (inv.total_cents <= 0) throw new UserError("The invoice total must be more than zero.");
  const entity = await tx.one<{ invoice_prefix: string; next_invoice_seq: number }>(
    "update entities set next_invoice_seq = next_invoice_seq + 1 where id = $1 returning invoice_prefix, next_invoice_seq - 1 as next_invoice_seq",
    [inv.entity_id],
  );
  const number = `${entity!.invoice_prefix}${String(entity!.next_invoice_seq).padStart(5, "0")}`;
  const settings = await agencySettings(tx);
  const today = todayIn(settings.timezone);
  const due = addDays(today, company!.payment_terms_days);
  await tx.q("update invoices set status = 'sent', number = $2, issue_date = $3, due_date = $4, sent_at = now() where id = $1", [invoiceId, number, today, due]);
  await tx.q("update time_entries set locked = true where invoice_line_id in (select id from invoice_lines where invoice_id = $1)", [invoiceId]);
  await tx.audit("invoice.sent", "invoice", invoiceId, { status: "draft" }, { status: "sent", number, total_cents: inv.total_cents, due_date: due });

  const billing = await tx.q<{ id: string; name: string; email: string }>(
    "select id, name, email from contacts where company_id = $1 and role = 'billing' and active",
    [inv.company_id],
  );
  const recipients = billing.length ? billing : company!.billing_email ? [{ id: null, name: company!.name, email: company!.billing_email }] : [];
  for (const r of recipients) {
    const link = r.id ? appUrl(`/hub/${await ensureHubToken(tx, r.id)}/invoices/${invoiceId}`) : "";
    await queueMessage(tx, {
      channel: "email",
      toName: r.name,
      to: r.email,
      subject: `Tax invoice ${number} from ${settings.name}`,
      body: `Hello ${r.name.split(" ")[0]},\n\nPlease find tax invoice ${number} for ${formatMoney(inv.total_cents, inv.currency)}, due ${formatShort(due)}.${
        inv.po_number ? `\nYour PO: ${inv.po_number}` : ""
      }\n\n${link ? `View, download and pay: ${link}\n\n` : ""}Use ${number} as the payment reference for EFT.\n\nThank you,\n${settings.name}`,
      relatedType: "invoice",
      relatedId: invoiceId,
    });
  }
  return number;
}

export async function recordPayment(tx: Tx, invoiceId: string, amountCents: number, reference: string) {
  const inv = await tx.one<{ status: string; total_cents: number; paid_cents: number; number: string }>(
    "select status, total_cents, paid_cents, number from invoices where id = $1",
    [invoiceId],
  );
  if (!inv || inv.status !== "sent") throw new UserError("Only sent invoices can take payments.");
  if (amountCents <= 0) throw new UserError("Enter the amount received.");
  const writtenOff = (await tx.one<{ v: number }>("select coalesce(sum(amount_cents),0) as v from write_offs where invoice_id = $1", [invoiceId]))!.v;
  const paid = inv.paid_cents + amountCents;
  const settled = paid + writtenOff >= inv.total_cents;
  await tx.q("update invoices set paid_cents = $2, status = $3, paid_at = case when $3 = 'paid' then now() else paid_at end where id = $1", [
    invoiceId,
    paid,
    settled ? "paid" : "sent",
  ]);
  await tx.audit("invoice.payment", "invoice", invoiceId, { paid_cents: inv.paid_cents }, { paid_cents: paid, reference, status: settled ? "paid" : "sent" });
}

export const WRITE_OFF_REASONS = [
  { key: "pricing_error", label: "Pricing error" },
  { key: "scope_absorbed", label: "Scope absorbed" },
  { key: "quality_issue", label: "Quality issue" },
  { key: "client_dispute", label: "Client dispute" },
  { key: "goodwill", label: "Goodwill" },
] as const;

/** Every write-off has a reason category (FN-14). */
export async function writeOff(tx: Tx, input: { invoice_id: string; amount_cents: number; reason: string; note: string }) {
  if (!WRITE_OFF_REASONS.some((r) => r.key === input.reason)) throw new UserError("Choose a write-off reason.");
  const inv = await tx.one<{ company_id: string; total_cents: number; paid_cents: number; status: string }>(
    "select company_id, total_cents, paid_cents, status from invoices where id = $1",
    [input.invoice_id],
  );
  if (!inv || inv.status !== "sent") throw new UserError("Write-offs apply to sent, unpaid invoices.");
  const prior = (await tx.one<{ v: number }>("select coalesce(sum(amount_cents),0) as v from write_offs where invoice_id = $1", [input.invoice_id]))!.v;
  const outstanding = inv.total_cents - inv.paid_cents - prior;
  if (input.amount_cents <= 0 || input.amount_cents > outstanding) throw new UserError(`Write-off must be between R0.01 and ${formatMoney(outstanding)}.`);
  await tx.q("insert into write_offs (agency_id, company_id, invoice_id, amount_cents, reason, note, created_by) values ($1,$2,$3,$4,$5,$6,$7)", [
    tx.agencyId,
    inv.company_id,
    input.invoice_id,
    input.amount_cents,
    input.reason,
    input.note,
    tx.userId,
  ]);
  if (input.amount_cents === outstanding) await tx.q("update invoices set status = 'paid', paid_at = now() where id = $1", [input.invoice_id]);
  await tx.audit("invoice.write_off", "invoice", input.invoice_id, { outstanding }, input);
}

export async function listInvoices(tx: Tx, filter: { status?: string; companyId?: string } = {}) {
  return tx.q<{
    id: string; number: string | null; status: string; company_name: string; company_id: string; issue_date: string | null; due_date: string | null;
    total_cents: number; paid_cents: number; written_off: number; currency: string; po_number: string; created_at: Date;
  }>(
    `select i.id, i.number, i.status, c.name as company_name, c.id as company_id, i.issue_date, i.due_date, i.total_cents, i.paid_cents, i.currency, i.po_number, i.created_at,
            coalesce((select sum(amount_cents) from write_offs w where w.invoice_id = i.id),0) as written_off
       from invoices i join companies c on c.id = i.company_id
      where ($1::text is null or i.status = $1) and ($2::uuid is null or i.company_id = $2)
      order by coalesce(i.issue_date, i.created_at::date) desc, i.created_at desc`,
    [filter.status ?? null, filter.companyId ?? null],
  );
}

/** Debtors by age (finance dashboard). */
export async function debtors(tx: Tx) {
  const settings = await agencySettings(tx);
  const today = todayIn(settings.timezone);
  const open = (await listInvoices(tx, { status: "sent" })).map((i) => {
    const outstanding = i.total_cents - i.paid_cents - i.written_off;
    const daysOverdue = i.due_date ? daysBetween(i.due_date, today) : 0;
    const bucket = daysOverdue <= 0 ? "current" : daysOverdue <= 30 ? "1–30" : daysOverdue <= 60 ? "31–60" : daysOverdue <= 90 ? "61–90" : "90+";
    return { ...i, outstanding, daysOverdue, bucket };
  });
  const buckets = ["current", "1–30", "31–60", "61–90", "90+"].map((b) => ({
    bucket: b,
    cents: open.filter((o) => o.bucket === b).reduce((s, o) => s + o.outstanding, 0),
  }));
  return { open, buckets, total: open.reduce((s, o) => s + o.outstanding, 0) };
}

/**
 * Collections (FN-07): polite reminders 3 days before due, on day 1, 7 and 14
 * after; escalate to the account manager at 14 days. Idempotent per step.
 */
export async function runCollections(tx: Tx) {
  const settings = await agencySettings(tx);
  const { open } = await debtors(tx);
  const steps = [-3, 1, 7, 14];
  for (const inv of open) {
    const step = [...steps].reverse().find((s) => inv.daysOverdue >= s);
    if (step === undefined) continue;
    const idx = steps.indexOf(step) + 1;
    const row = await tx.one<{ reminders_sent: number }>("select reminders_sent from invoices where id = $1", [inv.id]);
    if ((row?.reminders_sent ?? 0) >= idx) continue;
    const contacts = await tx.q<{ id: string; name: string; email: string }>("select id, name, email from contacts where company_id = $1 and role = 'billing' and active", [inv.company_id]);
    for (const c of contacts) {
      const link = appUrl(`/hub/${await ensureHubToken(tx, c.id)}/invoices/${inv.id}`);
      const tone =
        step < 0
          ? `A friendly heads-up that invoice ${inv.number} for ${formatMoney(inv.outstanding, inv.currency)} is due on ${formatShort(inv.due_date)}.`
          : `Invoice ${inv.number} for ${formatMoney(inv.outstanding, inv.currency)} was due on ${formatShort(inv.due_date)} and is now ${inv.daysOverdue} day(s) overdue. If it's already on its way, thank you and please ignore this.`;
      await queueMessage(tx, {
        channel: "email",
        toName: c.name,
        to: c.email,
        subject: step < 0 ? `Upcoming: invoice ${inv.number}` : `Reminder: invoice ${inv.number} is overdue`,
        body: `Hello ${c.name.split(" ")[0]},\n\n${tone}\n\nView and pay: ${link}\n\nThank you,\n${settings.name}`,
        relatedType: "invoice",
        relatedId: inv.id,
      });
    }
    await tx.q("update invoices set reminders_sent = $2, last_reminder_at = now() where id = $1", [inv.id, idx]);
    if (step >= 14) {
      const am = await tx.one<{ account_manager_id: string | null }>("select account_manager_id from companies where id = $1", [inv.company_id]);
      await notify(tx, [am?.account_manager_id], {
        kind: "collections",
        title: `Escalation: ${inv.company_name} invoice ${inv.number} is ${inv.daysOverdue} days overdue`,
        href: `/app/billing/invoices/${inv.id}`,
        dedupe: `collections-escalate:${inv.id}`,
      });
    }
  }
}

/** Unbilled WIP: work done but not yet invoiced, per job (FN-03). */
export async function wipValuation(tx: Tx) {
  const jobs = await tx.q<{ id: string; number: string; name: string; company_name: string; billing_model: string; fee_cents: number; budget_hours: number; status: string; hours: number; value: number; invoiced: number; cr_approved: number }>(
    `select j.id, j.number, j.name, c.name as company_name, j.billing_model, j.fee_cents, j.budget_hours, j.status,
            coalesce((select sum(hours) from time_entries te where te.job_id = j.id),0) as hours,
            coalesce((select sum(hours*rate_cents) from time_entries te where te.job_id = j.id and te.category='billable' and te.invoice_line_id is null and not te.out_of_scope),0) as value,
            coalesce((select sum(l.amount_cents) from invoice_lines l join invoices i on i.id = l.invoice_id where l.job_id = j.id and i.status in ('sent','paid') and l.source_type in ('milestone','manual')),0) as invoiced,
            coalesce((select sum(price_cents) from change_requests cr where cr.job_id = j.id and cr.status = 'approved'
                       and not exists (select 1 from invoice_lines l join invoices i on i.id = l.invoice_id where l.source_type='change_request' and l.source_id = cr.id and i.status <> 'void')),0) as cr_approved
       from jobs j join companies c on c.id = j.company_id
      where j.status <> 'closed' and j.billing_model in ('fixed','tm')`,
  );
  return jobs
    .map((j) => {
      let wip = 0;
      if (j.billing_model === "tm") wip = Math.round(j.value);
      else {
        const progress = j.status === "complete" ? 1 : j.budget_hours > 0 ? Math.min(1, j.hours / j.budget_hours) : 0;
        wip = Math.max(0, Math.round(j.fee_cents * progress) - j.invoiced);
      }
      return { ...j, wip: wip + j.cr_approved };
    })
    .filter((j) => j.wip > 0)
    .sort((a, b) => b.wip - a.wip);
}

/**
 * Accounting export in the column layout of Xero's sales-invoice CSV import.
 * Check the column names against Xero's current template before relying on it.
 */
export async function xeroCsv(tx: Tx, from: string, to: string) {
  const rows = await tx.q<{ company: string; email: string; number: string; po: string; issue: string; due: string; description: string; quantity: number; unit: number; currency: string; tax_rate: number }>(
    `select c.name as company, c.billing_email as email, i.number, i.po_number as po, i.issue_date::text as issue, i.due_date::text as due,
            l.description, l.quantity, l.unit_cents as unit, i.currency, i.tax_rate
       from invoices i join companies c on c.id = i.company_id join invoice_lines l on l.invoice_id = i.id
      where i.status in ('sent','paid') and i.issue_date between $1 and $2 order by i.number, l.sort`,
    [from, to],
  );
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const header = ["*ContactName", "EmailAddress", "*InvoiceNumber", "Reference", "*InvoiceDate", "*DueDate", "*Description", "*Quantity", "*UnitAmount", "*AccountCode", "*TaxType", "Currency"];
  const lines = rows.map((r) =>
    [r.company, r.email, r.number, r.po, r.issue, r.due, r.description, r.quantity, (r.unit / 100).toFixed(2), "200", r.tax_rate > 0 ? "Standard Rate Sales" : "No VAT", r.currency].map(esc).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

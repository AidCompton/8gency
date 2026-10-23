import type { Tx } from "../db";
import { addDays, daysBetween, formatShort, todayIn } from "../domain/dates";
import { formatMoney, invoiceTotals, lineAmount } from "../domain/money";
import { fireEvent } from "./automationEngine";
import { agencySettings, appUrl, ensureHubToken, notify, queueMessage, UserError } from "./core";
import { firstName } from "../domain/text";

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
 * approved change requests, re-billable costs and imported time. (Time logged
 * in 8gency doesn't wait here: syncUnbilledTime puts it straight onto the
 * client's open draft. Imported time may already have been billed in the old
 * tool, so a person confirms it here first.) Anything
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

  rows.push(
    ...(await tx.q<Omit<BillableItem, "key" | "age_days" | "overdue">>(
      `select 'time' as source_type, j.id as source_id, j.company_id, co.name as company_name, j.id as job_id, j.number as job_number,
              j.number || ' ' || j.name || ': imported time to ' || to_char(max(te.work_date), 'DD Mon') as description,
              round(sum(te.hours)::numeric, 2) as quantity,
              round(sum(te.hours * te.rate_cents) / nullif(sum(te.hours), 0)) as unit_cents,
              round(sum(te.hours * te.rate_cents)) as amount_cents,
              min(te.work_date)::text as ready_since, co.po_required
         from time_entries te join jobs j on j.id = te.job_id join companies co on co.id = j.company_id
        where j.bill_time and te.source = 'import' and te.category = 'billable' and te.invoice_line_id is null and not te.out_of_scope and not te.not_billed
          and (j.bill_time_from is null or te.work_date >= j.bill_time_from)
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

/**
 * The client's next invoice: their open draft, or a new one. One draft per
 * client at a time, so time, milestones and change requests all land on the
 * same invoice. Serialised per client so concurrent time logs can't make two.
 */
export async function openDraft(tx: Tx, companyId: string): Promise<{ id: string; created: boolean }> {
  await tx.q("select pg_advisory_xact_lock(hashtext('draft:' || $1))", [companyId]);
  const existing = await tx.one<{ id: string }>("select id from invoices where company_id = $1 and status = 'draft' order by created_at limit 1", [companyId]);
  if (existing) return { id: existing.id, created: false };
  const company = await tx.one<{ entity_id: string | null; currency: string }>("select entity_id, currency from companies where id = $1", [companyId]);
  const entity = await tx.one<{ id: string; tax_label: string; tax_rate: number; currency: string }>(
    "select id, tax_label, tax_rate, currency from entities where id = coalesce($1, (select id from entities where is_default limit 1))",
    [company?.entity_id ?? null],
  );
  if (!entity) throw new UserError("Set up a billing entity in Settings first.");
  const inv = await tx.one<{ id: string }>(
    `insert into invoices (agency_id, entity_id, company_id, currency, tax_label, tax_rate) values ($1,$2,$3,$4,$5,$6) returning id`,
    [tx.agencyId, entity.id, companyId, company?.currency ?? entity.currency, entity.tax_label, entity.tax_rate],
  );
  return { id: inv!.id, created: true };
}

const nextSort = async (tx: Tx, invoiceId: string) =>
  (await tx.one<{ n: number }>("select coalesce(max(sort), -1) + 1 as n from invoice_lines where invoice_id = $1", [invoiceId]))!.n;

/** Add ready-to-bill items to the client's next invoice (their open draft, or a new one). */
export async function createInvoice(tx: Tx, companyId: string, itemKeys: string[], extra: { po_number?: string; notes?: string } = {}) {
  const items = (await readyToBill(tx, companyId)).filter((i) => itemKeys.includes(i.key));
  if (!items.length) throw new UserError("Select at least one item to bill.");
  const draft = await openDraft(tx, companyId);
  const inv = { id: draft.id };
  if (extra.po_number || extra.notes) await tx.q("update invoices set po_number = coalesce(nullif($2,''), po_number), notes = coalesce(nullif($3,''), notes) where id = $1", [inv.id, extra.po_number ?? "", extra.notes ?? ""]);
  let sort = await nextSort(tx, inv.id);
  for (const item of items.filter((i) => i.source_type === "time")) await syncUnbilledTime(tx, companyId, { jobId: item.source_id, imported: true });
  for (const item of items.filter((i) => i.source_type !== "time")) {
    const line = await tx.one<{ id: string }>(
      `insert into invoice_lines (agency_id, invoice_id, job_id, description, quantity, unit_cents, amount_cents, source_type, source_id, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [tx.agencyId, inv!.id, item.job_id, item.description, item.quantity, item.unit_cents, item.amount_cents, item.source_type, item.source_id, sort++],
    );
    if (item.source_type === "milestone") await tx.q("update milestones set status = 'invoiced' where id = $1", [item.source_id]);
    if (item.source_type === "cost") await tx.q("update costs set invoice_line_id = $2 where id = $1", [item.source_id, line!.id]);
  }
  await recalcInvoice(tx, inv.id);
  await tx.audit(draft.created ? "invoice.drafted" : "invoice.items_added", "invoice", inv.id, undefined, { items: items.map((i) => i.key) });
  return inv.id;
}

/**
 * Billable time goes onto the client's next invoice by itself, so nobody has
 * to work out what was done or what it cost. Picks up every unbilled,
 * billable, in-scope entry on jobs that bill time (from their start date),
 * itemised per job, task and rate: "JOB-0001 Homepage design · Designer",
 * hours × rate. Later time on the same task and rate tops up the same line.
 * Imported time (history from another tool) only goes on when confirmed from
 * Ready to bill (opts.imported, for that job).
 * Idempotent: safe to call after any time change.
 */
export async function syncUnbilledTime(tx: Tx, companyId?: string | null, opts: { jobId?: string; imported?: boolean } = {}) {
  const groups = await tx.q<{ company_id: string; job_id: string; task_id: string | null; rate_cents: number; hours: number; description: string; notes: string[]; entry_ids: string[] }>(
    `select j.company_id, te.job_id, te.task_id, te.rate_cents, round(sum(te.hours)::numeric, 2) as hours,
            j.number || ' ' || coalesce(t.title, j.name) || coalesce(' · ' || string_agg(distinct nullif(u.title, ''), ', '), '') as description,
            -- What was done, from the time notes (minus the internal closed-job override prefix).
            array_remove(array_agg(distinct nullif(btrim(regexp_replace(te.notes, '^\\[closed-job override:[^]]*\\]\\s*', '')), '')), null) as notes,
            array_agg(te.id) as entry_ids
       from time_entries te
       join jobs j on j.id = te.job_id
       join users u on u.id = te.user_id
       left join tasks t on t.id = te.task_id
      where j.bill_time and te.category = 'billable' and not te.out_of_scope and not te.not_billed and te.invoice_line_id is null
        and (te.source <> 'import' or $2::boolean) -- imported history may have been billed in the old tool: only when confirmed
        and (j.bill_time_from is null or te.work_date >= j.bill_time_from)
        and ($3::uuid is null or j.id = $3)
        and ($1::uuid is null or j.company_id = $1)
      group by j.company_id, te.job_id, te.task_id, te.rate_cents, j.number, j.name, t.title
      order by j.number, t.title nulls first, te.rate_cents desc`,
    [companyId ?? null, opts.imported ?? false, opts.jobId ?? null],
  );
  const touched = new Map<string, { hours: number; lines: number }>();
  for (const g of groups) {
    const draft = await openDraft(tx, g.company_id);
    if (draft.created) await tx.audit("invoice.drafted", "invoice", draft.id, undefined, { from: "time" });
    const existing = await tx.one<{ id: string }>(
      "select id from invoice_lines where invoice_id = $1 and source_type = 'time' and job_id = $2 and task_id is not distinct from $3 and unit_cents = $4",
      [draft.id, g.job_id, g.task_id, g.rate_cents],
    );
    let lineId = existing?.id;
    if (lineId) {
      // Top up the hours, and add any notes the line doesn't mention yet (keeping edits made in the editor).
      const cur = (await tx.one<{ description: string }>("select description from invoice_lines where id = $1", [lineId]))!.description;
      const fresh = g.notes.filter((n) => !cur.includes(n));
      const description = fresh.length ? withNotes(`${cur}${cur.includes(" — ") ? "; " : " — "}`, fresh) : cur;
      await tx.q("update invoice_lines set quantity = quantity + $2, description = $3 where id = $1", [lineId, g.hours, description]);
    } else {
      lineId = (await tx.one<{ id: string }>(
        `insert into invoice_lines (agency_id, invoice_id, job_id, task_id, description, quantity, unit_cents, amount_cents, source_type, source_id, sort)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'time',$3,$9) returning id`,
        [tx.agencyId, draft.id, g.job_id, g.task_id, g.notes.length ? withNotes(`${g.description} — `, g.notes) : g.description, g.hours, g.rate_cents, lineAmount({ quantity: g.hours, unit_cents: g.rate_cents }), await nextSort(tx, draft.id)],
      ))!.id;
    }
    await tx.q("update time_entries set invoice_line_id = $1 where id = any($2::uuid[])", [lineId, g.entry_ids]);
    const t = touched.get(draft.id) ?? { hours: 0, lines: 0 };
    touched.set(draft.id, { hours: t.hours + Number(g.hours), lines: t.lines + 1 });
  }
  for (const [invoiceId, t] of touched) {
    await recalcInvoice(tx, invoiceId);
    await tx.audit("invoice.time_added", "invoice", invoiceId, undefined, { hours: Math.round(t.hours * 100) / 100, lines: t.lines });
  }
  return { drafts: touched.size, hours: [...touched.values()].reduce((s, t) => s + t.hours, 0) };
}

/** "prefix" + notes joined with "; ", capped so a line stays readable on the invoice. */
function withNotes(prefix: string, notes: string[]) {
  const text = prefix + notes.join("; ");
  return text.length > 400 ? `${text.slice(0, 399).trimEnd()}…` : text;
}

/** A time entry was deleted or changed while on a draft: take its hours off the line (and drop an empty line). */
export async function unbillTimeEntry(tx: Tx, entry: { hours: number; invoice_line_id: string }) {
  const line = await tx.one<{ invoice_id: string; status: string; quantity: number }>(
    "select l.invoice_id, i.status, l.quantity from invoice_lines l join invoices i on i.id = l.invoice_id where l.id = $1",
    [entry.invoice_line_id],
  );
  if (!line) return;
  if (line.status !== "draft") throw new UserError("This time is on an issued invoice and can't change. Raise a credit note instead.");
  const left = Math.round((Number(line.quantity) - Number(entry.hours)) * 100) / 100;
  if (left > 0) await tx.q("update invoice_lines set quantity = $2 where id = $1", [entry.invoice_line_id, left]);
  else await tx.q("delete from invoice_lines where id = $1", [entry.invoice_line_id]);
  // A draft that's now empty has nothing to send: remove it rather than leave an R0 invoice behind.
  if (!(await tx.one("select 1 from invoice_lines where invoice_id = $1", [line.invoice_id]))) {
    await tx.q("delete from invoices where id = $1 and status = 'draft'", [line.invoice_id]);
    await tx.audit("invoice.draft_deleted", "invoice", line.invoice_id, undefined, { reason: "last time entry removed" });
    return;
  }
  await recalcInvoice(tx, line.invoice_id);
}

export async function recalcInvoice(tx: Tx, invoiceId: string) {
  const inv = await tx.one<{ tax_rate: number }>("select tax_rate from invoices where id = $1", [invoiceId]);
  const lines = await tx.q<{ id: string; quantity: number; unit_cents: number }>("select id, quantity, unit_cents from invoice_lines where invoice_id = $1", [invoiceId]);
  for (const l of lines) await tx.q("update invoice_lines set amount_cents = $2 where id = $1", [l.id, lineAmount(l)]);
  const t = invoiceTotals(lines, inv!.tax_rate);
  await tx.q("update invoices set subtotal_cents = $2, tax_cents = $3, total_cents = $4 where id = $1", [invoiceId, t.subtotal_cents, t.tax_cents, t.total_cents]);
}

async function assertDraft(tx: Tx, invoiceId: string) {
  const inv = await tx.one<{ status: string }>("select status from invoices where id = $1", [invoiceId]);
  if (!inv) throw new UserError("Invoice not found.");
  if (inv.status !== "draft") throw new UserError("Only draft invoices can be changed. Issue a credit note for sent invoices.");
}

/** Put a line's source (milestone, time, cost) back in the ready-to-bill queue. */
async function releaseLine(tx: Tx, l: { id: string; source_type: string; source_id: string | null }) {
  if (l.source_type === "milestone") await tx.q("update milestones set status = 'complete' where id = $1", [l.source_id]);
  if (l.source_type === "time") await tx.q("update time_entries set invoice_line_id = null where invoice_line_id = $1", [l.id]);
  if (l.source_type === "cost") await tx.q("update costs set invoice_line_id = null where invoice_line_id = $1", [l.id]);
}

export interface DraftLine {
  /** Existing line id; omit for a new manual line. */
  id?: string;
  description: string;
  quantity: number;
  unit_cents: number;
}

export interface DraftInvoiceEdit {
  lines: DraftLine[];
  po_number: string;
  notes: string;
  /** Blank = the client's payment terms from the issue date. */
  due_date: string | null;
  /** 0.15 = 15%. */
  tax_rate: number;
  exchange_rate: number;
}

/**
 * Save the whole draft in one go: header fields plus every line. Kept lines
 * are updated in the order given, new ones are added as manual lines, and
 * removed lines are deleted with their sources released back to the
 * ready-to-bill queue. Sent invoices never change (credit notes instead).
 */
export async function saveDraftInvoice(tx: Tx, invoiceId: string, f: DraftInvoiceEdit) {
  await assertDraft(tx, invoiceId);
  const lines = f.lines.filter((l) => l.id || l.description.trim() || l.unit_cents);
  if (!lines.length) throw new UserError("An invoice needs at least one line. Delete the draft instead.");
  for (const l of lines) {
    if (!l.description.trim()) throw new UserError("Every line needs a description.");
    if (!Number.isFinite(l.quantity) || l.quantity <= 0) throw new UserError(`Quantity must be more than zero on “${l.description.trim()}”.`);
    if (!Number.isFinite(l.unit_cents)) throw new UserError(`Enter a unit price on “${l.description.trim()}”.`);
  }
  if (!Number.isFinite(f.tax_rate) || f.tax_rate < 0 || f.tax_rate > 1) throw new UserError("Tax rate must be between 0% and 100%.");
  if (f.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(f.due_date)) throw new UserError("Enter the due date as a date.");

  const before = await tx.one<{ total_cents: number; po_number: string; due_date: string | null; tax_rate: number }>("select total_cents, po_number, due_date, tax_rate from invoices where id = $1", [invoiceId]);
  const existing = await tx.q<{ id: string; source_type: string; source_id: string | null }>("select id, source_type, source_id from invoice_lines where invoice_id = $1", [invoiceId]);
  const kept = new Set(lines.map((l) => l.id).filter(Boolean));
  for (const l of lines) if (l.id && !existing.some((e) => e.id === l.id)) throw new UserError("A line was changed elsewhere. Reload the invoice and try again.");
  const removed = existing.filter((e) => !kept.has(e.id));
  for (const e of removed) {
    if (e.source_type === "time") {
      // Removing time from the invoice = choosing not to charge it. Mark it so the next sync doesn't add it back.
      const h = (await tx.one<{ hours: number }>("select coalesce(sum(hours), 0) as hours from time_entries where invoice_line_id = $1", [e.id]))!.hours;
      await tx.q("update time_entries set not_billed = true, invoice_line_id = null where invoice_line_id = $1", [e.id]);
      await tx.audit("time.written_down", "invoice", invoiceId, undefined, { line: e.id, hours: Number(h) });
    } else {
      await releaseLine(tx, e);
    }
    await tx.q("delete from invoice_lines where id = $1", [e.id]);
  }
  let sort = 0;
  for (const l of lines) {
    if (l.id) {
      await tx.q("update invoice_lines set description = $2, quantity = $3, unit_cents = $4, sort = $5 where id = $1", [l.id, l.description.trim(), l.quantity, l.unit_cents, sort++]);
    } else {
      await tx.q(
        `insert into invoice_lines (agency_id, invoice_id, description, quantity, unit_cents, amount_cents, source_type, sort)
         values ($1,$2,$3,$4,$5,$6,'manual',$7)`,
        [tx.agencyId, invoiceId, l.description.trim(), l.quantity, l.unit_cents, lineAmount(l), sort++],
      );
    }
  }
  await tx.q("update invoices set po_number = $2, notes = $3, due_date = $4, tax_rate = $5, exchange_rate = $6 where id = $1", [
    invoiceId,
    f.po_number.trim(),
    f.notes,
    f.due_date || null,
    f.tax_rate,
    f.exchange_rate || 1,
  ]);
  await recalcInvoice(tx, invoiceId);
  const after = await tx.one<{ total_cents: number }>("select total_cents from invoices where id = $1", [invoiceId]);
  await tx.audit("invoice.edited", "invoice", invoiceId, { ...before, lines: existing.length }, {
    total_cents: after!.total_cents,
    po_number: f.po_number.trim(),
    due_date: f.due_date || null,
    tax_rate: f.tax_rate,
    lines: lines.length,
    lines_removed: removed.length,
  });
}

/** Release the sources of a draft back to the ready-to-bill queue. */
export async function voidInvoice(tx: Tx, invoiceId: string) {
  const inv = await tx.one<{ status: string; number: string | null }>("select status, number from invoices where id = $1", [invoiceId]);
  if (!inv) return;
  if (inv.status === "paid") throw new UserError("A paid invoice can't be voided. Use a credit note.");
  const lines = await tx.q<{ id: string; source_type: string; source_id: string | null }>("select id, source_type, source_id from invoice_lines where invoice_id = $1", [invoiceId]);
  for (const l of lines) await releaseLine(tx, l);
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
  const inv = await tx.one<{ status: string; company_id: string; entity_id: string; po_number: string; total_cents: number; currency: string; due_date: string | null }>(
    "select status, company_id, entity_id, po_number, total_cents, currency, due_date::text from invoices where id = $1",
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
  const due = inv.due_date && inv.due_date >= today ? inv.due_date : addDays(today, company!.payment_terms_days);
  await tx.q("update invoices set status = 'sent', number = $2, issue_date = $3, due_date = $4, sent_at = now() where id = $1", [invoiceId, number, today, due]);
  await tx.q("update time_entries set locked = true where invoice_line_id in (select id from invoice_lines where invoice_id = $1)", [invoiceId]);
  await tx.audit("invoice.sent", "invoice", invoiceId, { status: "draft" }, { status: "sent", number, total_cents: inv.total_cents, due_date: due });
  await fireEvent(tx, "invoice.sent", invoiceId);

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
      body: `Hello ${firstName(r.name)},\n\nPlease find tax invoice ${number} for ${formatMoney(inv.total_cents, inv.currency)}, due ${formatShort(due)}.${
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
  // Paid by the client (not settled by a write-off): a thank-you is appropriate.
  if (settled) await fireEvent(tx, "invoice.paid", invoiceId);
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
        body: `Hello ${firstName(c.name)},\n\n${tone}\n\nView and pay: ${link}\n\nThank you,\n${settings.name}`,
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

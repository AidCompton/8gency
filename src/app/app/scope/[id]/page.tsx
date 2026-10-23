import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/SubmitButton";
import { absorbChangeRequestAction, recordDecisionAction, sendChangeRequestAction, updateChangeRequestAction } from "../../_actions/scope";
import { Card, Field, Money, PageHeader, StatusBadge, buttonClass } from "@/components/ui";
import { requireUser, tenant } from "@/lib/auth";
import { formatMoney } from "@/lib/domain/money";
import { changeRequestMessage } from "@/lib/domain/scope";
import { can } from "@/lib/permissions";
import { getChangeRequest, suggestEstimate } from "@/lib/services/scope";

export const metadata = { title: "Change request" };

export default async function ChangeRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const money = can(user, "seeMargins");
  const data = await tenant(user, async (tx) => {
    const cr = await getChangeRequest(tx, id);
    if (!cr) return null;
    return {
      cr,
      suggestion: cr.status === "draft" ? await suggestEstimate(tx, cr.title, cr.company_id) : null,
      approvals: await tx.q<{ id: string; decision: string; approver_name: string; channel: string; note: string; created_at: Date }>("select id, decision, approver_name, channel, note, created_at from approvals where subject_type = 'change_request' and subject_id = $1 order by created_at", [id]),
      approver: await tx.one<{ name: string }>("select name from contacts where company_id = $1 and role = 'approver' and active order by created_at limit 1", [cr.company_id]),
      messages: await tx.q<{ channel: string; to_name: string; created_at: Date }>("select channel, to_name, created_at from outbox_messages where related_type = 'change_request' and related_id = $1 order by created_at", [id]),
    };
  });
  if (!data) notFound();
  const { cr, suggestion } = data;
  const draft = cr.status === "draft";
  return (
    <>
      <PageHeader
        back={{ href: "/app/scope?tab=changes", label: "Change requests" }}
        title={<span className="flex items-center gap-2">{cr.title} <StatusBadge status={cr.status} /></span>}
        subtitle={<>{cr.company_name}{cr.job_number && <> · <Link className="hover:underline" href={`/app/jobs/${cr.job_id}?tab=scope`}>{cr.job_number}</Link></>} · origin: {cr.origin.replace("_", " ")}</>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card title={draft ? "Price it" : "Details"}>
            {draft && can(user, "createChangeRequests") ? (
              <form action={updateChangeRequestAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="id" value={id} />
                <Field label="Title" className="sm:col-span-2"><input name="title" defaultValue={cr.title} /></Field>
                <Field label="What it includes" className="sm:col-span-2"><textarea name="description" defaultValue={cr.description} /></Field>
                <Field label="Estimated hours"><input name="estimate_hours" defaultValue={cr.estimate_hours} /></Field>
                <Field label="Price (excl. VAT)" hint="Leave as is to price from the rate card."><input name="price" defaultValue={(cr.price_cents / 100).toFixed(2)} /></Field>
                <div><SubmitButton className={buttonClass("secondary", "sm")}>Save</SubmitButton></div>
              </form>
            ) : (
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-ink-2">Description</dt><dd>{cr.description || "—"}</dd>
                <dt className="text-ink-2">Estimate</dt><dd>{cr.estimate_hours}h</dd>
                <dt className="text-ink-2">Price</dt><dd><Money cents={cr.price_cents} visible={money} /></dd>
                {cr.absorb_reason && <><dt className="text-ink-2">Absorbed because</dt><dd>{cr.absorb_reason}</dd></>}
                {cr.decided_by && <><dt className="text-ink-2">Decided by</dt><dd>{cr.decided_by} via {cr.decided_channel}</dd></>}
              </dl>
            )}
          </Card>
          {draft && (
            <Card title="What the client will receive">
              <pre className="whitespace-pre-wrap font-sans text-sm text-ink-2">{changeRequestMessage({ contactName: data.approver?.name ?? "there", title: cr.title, description: cr.description, hours: cr.estimate_hours, price: formatMoney(cr.price_cents), agencyName: user.agency_name, senderName: user.name })}</pre>
              <p className="mt-2 text-xs text-ink-3">Plus a one-click approve link, and reply codes for email and WhatsApp.</p>
            </Card>
          )}
          {data.approvals.length > 0 && (
            <Card title="Decision record">
              <ul className="space-y-2 text-sm">
                {data.approvals.map((a) => <li key={a.id}><b className={a.decision === "approved" ? "text-good-ink" : ""}>{a.decision}</b> by {a.approver_name} via {a.channel} · {new Date(a.created_at).toLocaleString("en-ZA")}{a.note && <div className="text-xs text-ink-2">“{a.note}”</div>}</li>)}
              </ul>
            </Card>
          )}
        </div>
        <aside className="space-y-4">
          {suggestion && (
            <Card title="8gent estimate from history">
              {suggestion.hours !== null ? (
                <>
                  <p className="text-sm">Similar past work took a median of <b>{suggestion.hours}h</b>{suggestion.range && <> (range {suggestion.range[0]}–{suggestion.range[1]}h)</>} ≈ <b><Money cents={Math.round((suggestion.hours ?? 0) * suggestion.rate)} visible={money} /></b>.</p>
                  <ul className="mt-2 list-disc pl-5 text-xs text-ink-3">{suggestion.basis.map((b) => <li key={b}>{b}</li>)}</ul>
                </>
              ) : <p className="text-sm text-ink-3">No similar completed tasks yet. Blended rate is <Money cents={suggestion.rate} visible={money} />/h.</p>}
            </Card>
          )}
          {["draft", "sent"].includes(cr.status) && can(user, "sendChangeRequests") && (
            <Card title="Decide">
              <div className="space-y-4">
                {draft && (
                  <form action={sendChangeRequestAction}>
                    <input type="hidden" name="id" value={id} />
                    <SubmitButton className={buttonClass("primary") + " w-full"}>Send to client for approval</SubmitButton>
                  </form>
                )}
                <form action={absorbChangeRequestAction} className="space-y-2 border-t border-line pt-3">
                  <input type="hidden" name="id" value={id} />
                  <Field label="Why are we absorbing this?"><input name="reason" required /></Field>
                  <SubmitButton className={buttonClass("secondary", "sm")}>Absorb as an investment</SubmitButton>
                </form>
                <form action={recordDecisionAction} className="space-y-2 border-t border-line pt-3">
                  <input type="hidden" name="id" value={id} />
                  <p className="text-xs text-ink-3">Client agreed on a call or in a meeting?</p>
                  <Field label="Who agreed"><input name="approver_name" defaultValue={data.approver?.name} /></Field>
                  <div className="flex gap-2">
                    <SubmitButton name="decision" value="approved" className={buttonClass("secondary", "sm")}>Record approval</SubmitButton>
                    <SubmitButton name="decision" value="declined" className={buttonClass("ghost", "sm")}>Record decline</SubmitButton>
                  </div>
                </form>
              </div>
            </Card>
          )}
          {data.messages.length > 0 && (
            <Card title="Sent">
              <ul className="space-y-1 text-xs text-ink-2">{data.messages.map((m, i) => <li key={i}>{m.channel} → {m.to_name} · {new Date(m.created_at).toLocaleString("en-ZA")}</li>)}</ul>
            </Card>
          )}
          {cr.status === "approved" && <Card title="Next"><p className="text-sm text-ink-2">Added to the scope baseline and waiting in the ready-to-bill queue.</p></Card>}
        </aside>
      </div>
    </>
  );
}

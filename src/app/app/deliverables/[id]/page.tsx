import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/SubmitButton";
import { addFeedbackAction, internalDecisionAction, internalReviewAction, recordClientDecisionAction, sendToClientAction, uploadVersionAction } from "../../_actions/review";
import { Proof } from "@/components/Proof";
import { Badge, Card, Field, PageHeader, StatusBadge, buttonClass, StatusIcon, cx } from "@/components/ui";
import { requireUser, tenant } from "@/lib/auth";
import { ageSince } from "@/lib/domain/dates";
import { can } from "@/lib/permissions";
import { deliverableHistory, getDeliverable, roundsAllowance } from "@/lib/services/review";

export const metadata = { title: "Review" };

export default async function DeliverablePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const data = await tenant(user, async (tx) => {
    const d = await getDeliverable(tx, id);
    if (!d) return null;
    const approver = d.approver_contact_id ? await tx.one<{ name: string }>("select name from contacts where id = $1", [d.approver_contact_id]) : null;
    return { d, approver, h: await deliverableHistory(tx, id) };
  });
  if (!data) notFound();
  const { d, h, approver } = data;
  const current = h.versions.find((v) => v.id === sp.v) ?? h.versions[0];
  const latest = h.versions[0];
  const comments = h.feedback.filter((f) => f.version_id === current?.id);
  const allowed = roundsAllowance(d);
  const roundsLeft = allowed - d.rounds_used;
  const canSend = ["draft", "changes_requested"].includes(d.status) && latest;
  return (
    <>
      <PageHeader
        back={{ href: `/app/jobs/${d.job_id}?tab=review`, label: `${d.job_number} ${d.job_name}` }}
        title={<span className="flex flex-wrap items-center gap-2">{d.name} <StatusBadge status={d.status} /></span>}
        subtitle={<>{d.company_name} · {d.scope_name ? `Scope: ${d.scope_name}` : "Not linked to scope"} · Round {d.rounds_used} of {allowed}{approver ? ` · Approver: ${approver.name}` : ""}{d.status === "client_review" && d.sent_to_client_at ? ` · with client ${ageSince(d.sent_to_client_at)}` : ""}</>}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {current ? (
            <Card title={`Version ${current.number}${current.id !== latest.id ? " (not the latest)" : ""}`} actions={<span className="text-xs text-ink-3">{current.file_name}</span>}>
              <Proof src={`/api/files/${current.id}`} mime={current.mime} comments={comments} formId="comment-form" />
              {current.notes && <p className="mt-3 text-sm text-ink-2">Notes: {current.notes}</p>}
            </Card>
          ) : (
            <Card title="No versions yet"><p className="text-sm text-ink-2">Upload the first version to start review.</p></Card>
          )}
          {h.versions.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {h.versions.map((v) => (
                <Link key={v.id} href={`/app/deliverables/${id}?v=${v.id}`} className={`rounded-lg border px-3 py-1.5 text-sm ${v.id === current?.id ? "border-brand bg-brand/10" : "border-line hover:bg-surface-2"}`}>v{v.number}</Link>
              ))}
            </div>
          )}
          {current && (
            <Card title={`Comments on v${current.number}`}>
              {comments.length ? (
                <ol className="space-y-3">
                  {comments.map((c, i) => (
                    <li key={c.id} className="text-sm">
                      <div className="flex items-center gap-2 text-xs text-ink-3">
                        {c.pin_x !== null && <span className="font-bold text-ink">#{comments.filter((x) => x.pin_x !== null).indexOf(c) + 1}</span>}
                        <b className="text-ink-2">{c.author_name}</b> {c.is_client ? <Badge tone="warning">client</Badge> : <Badge>internal</Badge>} via {c.channel} · {new Date(c.created_at).toLocaleString("en-ZA")}
                        {c.timecode !== null && <> · at {c.timecode}s</>}
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
                      <span className="sr-only">Comment {i + 1}</span>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm text-ink-3">No comments on this version.</p>}
              <form id="comment-form" action={addFeedbackAction} className="mt-4 space-y-2 border-t border-line pt-3">
                <input type="hidden" name="deliverable_id" value={id} />
                <input type="hidden" name="version_id" value={current.id} />
                <input type="hidden" name="pin_x" />
                <input type="hidden" name="pin_y" />
                <input type="hidden" name="timecode" />
                <Field label="Internal comment" hint="Click the image first to pin it to a spot."><textarea name="body" required /></Field>
                <SubmitButton className={buttonClass("secondary", "sm")}>Comment</SubmitButton>
              </form>
            </Card>
          )}
        </div>
        <aside className="space-y-4">
          <Card title="Next step">
            {d.status === "approved" ? (
              <p className="flex items-start gap-1.5 text-sm text-good-ink"><StatusIcon tone="good" /> Approved. Final files live with the client's approved work.</p>
            ) : (
              <div className="space-y-4">
                {["draft", "changes_requested"].includes(d.status) && (
                  <form action={uploadVersionAction} className="space-y-2">
                    <input type="hidden" name="deliverable_id" value={id} />
                    <Field label="Upload a new version"><input type="file" name="file" required /></Field>
                    <Field label="What changed?"><input name="notes" /></Field>
                    <SubmitButton className={buttonClass("secondary", "sm")}>Upload v{(latest?.number ?? 0) + 1}</SubmitButton>
                  </form>
                )}
                {d.status === "draft" && latest && (
                  <form action={internalReviewAction}>
                    <input type="hidden" name="deliverable_id" value={id} />
                    <SubmitButton className={buttonClass("secondary", "sm")}>Request internal review</SubmitButton>
                  </form>
                )}
                {d.status === "internal_review" && can(user, "approveInternal") && (
                  <form action={internalDecisionAction} className="space-y-2">
                    <input type="hidden" name="deliverable_id" value={id} />
                    <Field label="Review notes (optional)"><textarea name="note" /></Field>
                    <div className="flex gap-2">
                      <SubmitButton name="decision" value="approved" className={buttonClass("primary", "sm")}>Pass internal review</SubmitButton>
                      <SubmitButton name="decision" value="changes_requested" className={buttonClass("danger", "sm")}>Needs changes</SubmitButton>
                    </div>
                  </form>
                )}
                {canSend && (
                  <form action={sendToClientAction} className="space-y-2 border-t border-line pt-3">
                    <input type="hidden" name="deliverable_id" value={id} />
                    <p className="text-sm">
                      Send v{latest.number} to {approver?.name ?? "the client approver"}.{" "}
                      {roundsLeft > 0 ? <span className="text-ink-2">{roundsLeft} round(s) left in scope.</span> : <span className="font-medium text-warning-ink"><StatusIcon tone="warning" /> All {allowed} round(s) in scope are used.</span>}
                    </p>
                    {roundsLeft <= 0 && (
                      <div className="space-y-2 rounded-lg bg-warning/10 p-3 text-sm">
                        <label className="flex items-center gap-2"><input type="radio" name="rounds_choice" value="change_request" defaultChecked /> Raise a change request for the extra round</label>
                        <label className="flex items-center gap-2"><input type="radio" name="rounds_choice" value="absorb" /> Absorb it, with a reason:</label>
                        <input name="absorb_reason" aria-label="Reason to absorb the extra round" placeholder="e.g. Our error on v2" />
                      </div>
                    )}
                    <SubmitButton className={buttonClass("primary", "sm")}>Send for client approval</SubmitButton>
                    <p className="text-xs text-ink-3">The client gets a hub link by email and WhatsApp, and can reply APPROVE or CHANGES.</p>
                  </form>
                )}
                {d.status === "client_review" && can(user, "sendChangeRequests") && (
                  <form action={recordClientDecisionAction} className="space-y-2">
                    <input type="hidden" name="deliverable_id" value={id} />
                    <p className="text-sm text-ink-2">Client decided in a meeting or on a call? Record it.</p>
                    <Field label="Who decided"><input name="approver_name" defaultValue={approver?.name} /></Field>
                    <Field label="What they said"><textarea name="note" /></Field>
                    <div className="flex gap-2">
                      <SubmitButton name="decision" value="approved" className={buttonClass("secondary", "sm")}>Record approval</SubmitButton>
                      <SubmitButton name="decision" value="changes_requested" className={buttonClass("ghost", "sm")}>Record changes</SubmitButton>
                    </div>
                  </form>
                )}
              </div>
            )}
          </Card>
          <Card title="Approval record">
            {h.approvals.length ? (
              <ol className="space-y-2 text-sm">
                {h.approvals.map((a) => (
                  <li key={a.id}>
                    <span className={cx("inline-flex items-center gap-1 font-medium", a.decision === "approved" ? "text-good-ink" : "text-critical-ink")}>{a.decision === "approved" ? <><StatusIcon tone="good" /> Approved</> : <><StatusIcon tone="critical" /> Changes requested</>}</span>{" "}
                    v{a.version_number} · {a.stage} · <b>{a.approver_name}</b> via {a.channel}
                    <div className="text-xs text-ink-3">{new Date(a.created_at).toLocaleString("en-ZA")}</div>
                    {a.note && <div className="text-xs text-ink-2">“{a.note}”</div>}
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-ink-3">No decisions yet.</p>}
            <p className="mt-3 text-xs text-ink-3">Approval records are immutable: approver, version, stage, channel and time.</p>
          </Card>
        </aside>
      </div>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { hubCommentAction, hubDecisionAction } from "../../actions";
import { Proof } from "@/components/Proof";
import { Card, StatusBadge, buttonClass } from "@/components/ui";
import { ageSince } from "@/lib/domain/dates";
import { asContact, resolveHubToken } from "@/lib/services/hub";
import { deliverableHistory, getDeliverable } from "@/lib/services/review";

export default async function HubReview({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const contact = await resolveHubToken(token);
  if (!contact) notFound();
  const data = await asContact(contact, async (tx) => {
    const d = await getDeliverable(tx, id);
    if (!d || d.company_id !== contact.company_id) return null;
    return { d, h: await deliverableHistory(tx, id) };
  });
  if (!data) notFound();
  const { d, h } = data;
  const v = h.versions[0];
  const comments = h.feedback.filter((f) => f.version_id === v?.id);
  const canDecide = d.status === "client_review" && contact.role === "approver";
  return (
    <div className="space-y-4">
      <Link href={`/hub/${token}`} className="text-sm text-ink-3 hover:text-ink">← Everything</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{d.name}</h1>
        <StatusBadge status={d.status} />
      </div>
      <p className="text-sm text-ink-2">{d.job_name} · version {v?.number ?? "—"} · round {d.rounds_used}{d.status === "client_review" && d.sent_to_client_at ? ` · waiting on you for ${ageSince(d.sent_to_client_at)}` : ""}</p>
      {v ? (
        <Card>
          <Proof src={`/api/files/${v.id}?hub=${encodeURIComponent(token)}`} mime={v.mime} comments={comments} formId="hub-comment" />
        </Card>
      ) : <Card><p className="text-sm">The team hasn't uploaded a version yet.</p></Card>}
      {canDecide && v && (
        <Card title="Your decision">
          <form action={hubDecisionAction} className="space-y-3">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="deliverable_id" value={id} />
            <input type="hidden" name="version_id" value={v.id} />
            <textarea name="note" placeholder="Anything to add? Required if you'd like changes." />
            <div className="flex flex-wrap gap-2">
              <button name="decision" value="approved" className={buttonClass("primary")}>✓ Approve version {v.number}</button>
              <button name="decision" value="changes_requested" className={buttonClass("secondary")}>Request changes</button>
            </div>
            <p className="text-xs text-ink-3">Your approval is recorded with your name, the version, the time and this channel.</p>
          </form>
        </Card>
      )}
      {d.status === "client_review" && contact.role !== "approver" && <p className="text-sm text-ink-2">You can comment; approval comes from your named approver.</p>}
      {v && (
        <Card title="Comments">
          {comments.length ? (
            <ol className="space-y-2 text-sm">{comments.map((c) => <li key={c.id}><b>{c.author_name}</b>{c.timecode !== null && ` at ${c.timecode}s`}: {c.body}</li>)}</ol>
          ) : <p className="text-sm text-ink-3">No comments yet. Tap the image to point at something.</p>}
          {d.status !== "approved" && (
            <form id="hub-comment" action={hubCommentAction} className="mt-3 space-y-2">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="deliverable_id" value={id} />
              <input type="hidden" name="version_id" value={v.id} />
              <input type="hidden" name="pin_x" />
              <input type="hidden" name="pin_y" />
              <input type="hidden" name="timecode" />
              <textarea name="body" required placeholder="Comment" />
              <button className={buttonClass("secondary", "sm")}>Add comment</button>
            </form>
          )}
        </Card>
      )}
      {h.approvals.filter((a) => a.stage === "client").length > 0 && (
        <Card title="History">
          <ul className="space-y-1 text-sm text-ink-2">{h.approvals.filter((a) => a.stage === "client").map((a) => <li key={a.id}>v{a.version_number}: {a.decision.replace("_", " ")} by {a.approver_name} via {a.channel} · {new Date(a.created_at).toLocaleString("en-ZA")}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}

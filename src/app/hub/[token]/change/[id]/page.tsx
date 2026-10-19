import Link from "next/link";
import { notFound } from "next/navigation";
import { hubChangeDecisionAction } from "../../actions";
import { Card, Money, StatusBadge, buttonClass } from "@/components/ui";
import { asContact, resolveHubToken } from "@/lib/services/hub";
import { getChangeRequest } from "@/lib/services/scope";

export default async function HubChange({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const contact = await resolveHubToken(token);
  if (!contact) notFound();
  const cr = await asContact(contact, (tx) => getChangeRequest(tx, id));
  if (!cr || cr.company_id !== contact.company_id) notFound();
  return (
    <div className="space-y-4">
      <Link href={`/hub/${token}`} className="text-sm text-ink-3 hover:text-ink">← Everything</Link>
      <div className="flex items-center gap-2"><h1 className="text-xl font-semibold">Change request</h1><StatusBadge status={cr.status} /></div>
      <Card>
        <h2 className="font-semibold">{cr.title}</h2>
        {cr.description && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-2">{cr.description}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-ink-2">Estimate</dt><dd>{cr.estimate_hours} hours</dd>
          <dt className="text-ink-2">Price</dt><dd className="font-semibold"><Money cents={cr.price_cents} /> excl. VAT</dd>
          {cr.job_name && <><dt className="text-ink-2">For</dt><dd>{cr.job_name}</dd></>}
        </dl>
        <p className="mt-3 text-xs text-ink-3">This sits outside the scope agreed for this work. Nothing is charged unless you approve it.</p>
      </Card>
      {cr.status === "sent" && contact.role === "approver" && (
        <Card>
          <form action={hubChangeDecisionAction} className="space-y-3">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="change_request_id" value={id} />
            <textarea name="note" placeholder="Optional note" />
            <div className="flex gap-2">
              <button name="decision" value="approved" className={buttonClass("primary")}>Approve and go ahead</button>
              <button name="decision" value="declined" className={buttonClass("secondary")}>Decline</button>
            </div>
          </form>
        </Card>
      )}
      {cr.decided_by && <p className="text-sm text-ink-2">{cr.status} by {cr.decided_by} via {cr.decided_channel}.</p>}
    </div>
  );
}

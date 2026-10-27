import { adminQuery, withTenant } from "../db";
import { parseReply } from "../domain/inbound";
import { decideChangeRequest, submitClientRequest } from "./scope";
import { addFeedback, clientDecision, latestVersion } from "./review";

export interface InboundResult {
  status: "approved" | "changes_requested" | "declined" | "comment" | "request" | "ignored";
  detail: string;
}

/**
 * Handle a client's email reply or WhatsApp message (M06). Messages carrying a
 * reference code act on that item; anything else from a known contact becomes
 * a new request in the triage queue, never a task (M06 acceptance).
 */
export async function processInbound(input: { channel: "email" | "whatsapp"; from: string; text: string }): Promise<InboundResult> {
  const parsed = parseReply(input.text);
  if (parsed.code) {
    const [tok] = await adminQuery<{ agency_id: string; contact_id: string; subject_type: "deliverable" | "change_request"; subject_id: string; name: string; email: string; phone: string }>(
      `select t.agency_id, t.contact_id, t.subject_type, t.subject_id, c.name, c.email, c.phone
         from action_tokens t join contacts c on c.id = t.contact_id
        where t.code = $1 and t.expires_at > now() and c.active`,
      [parsed.code],
    );
    if (tok) {
      // The sender must be the contact the code was issued to.
      const sender = input.from.trim().toLowerCase();
      const senderDigits = sender.replace(/[^0-9]/g, "");
      const phoneDigits = tok.phone.replace(/[^0-9]/g, "");
      const matches =
        (tok.email !== "" && sender === tok.email.toLowerCase()) ||
        (phoneDigits.length >= 9 && senderDigits.length >= 9 && senderDigits.slice(-9) === phoneDigits.slice(-9));
      if (!matches) return { status: "ignored", detail: "Sender does not match the contact this reference was issued to." };
      return withTenant({ agencyId: tok.agency_id, actorLabel: `${tok.name} (client via ${input.channel})` }, async (tx) => {
        if (tok.subject_type === "deliverable") {
          if (parsed.decision === "approved" || parsed.decision === "changes_requested") {
            await clientDecision(tx, tok.subject_id, { decision: parsed.decision, channel: input.channel, contactId: tok.contact_id, approverName: tok.name, note: parsed.body });
            return { status: parsed.decision, detail: `Recorded on deliverable ${tok.subject_id}` };
          }
          const v = await latestVersion(tx, tok.subject_id);
          if (v && parsed.body) {
            await addFeedback(tx, { deliverableId: tok.subject_id, versionId: v.id, body: parsed.body, channel: input.channel, authorName: tok.name, contactId: tok.contact_id });
            return { status: "comment", detail: "Feedback attached to the latest version" };
          }
          return { status: "ignored", detail: "Nothing to record" };
        }
        if (parsed.decision === "approved" || parsed.decision === "declined") {
          await decideChangeRequest(tx, tok.subject_id, { decision: parsed.decision, channel: input.channel, contactId: tok.contact_id, approverName: tok.name, note: parsed.body });
          return { status: parsed.decision, detail: `Change request ${parsed.decision}` };
        }
        return { status: "ignored", detail: "Reply APPROVE or DECLINE with the reference code." };
      });
    }
  }
  const normalized = input.from.trim().toLowerCase();
  const digits = normalized.replace(/[^0-9]/g, "");
  const [contact] = await adminQuery<{ id: string; agency_id: string; company_id: string; name: string }>(
    `select id, agency_id, company_id, name from contacts
      where active and (lower(email) = $1 or (length($2) >= 9 and right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) = right($2, 9))) limit 1`,
    [normalized, digits],
  );
  if (!contact) return { status: "ignored", detail: "Unknown sender" };
  await withTenant({ agencyId: contact.agency_id, actorLabel: `${contact.name} (client via ${input.channel})` }, (tx) =>
    submitClientRequest(tx, { company_id: contact.company_id, contact_id: contact.id, body: input.text, channel: input.channel }),
  );
  return { status: "request", detail: "Added to the triage queue" };
}

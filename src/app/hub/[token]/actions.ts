"use server";
import { notFound } from "next/navigation";
import { act, num, str } from "@/lib/actions";
import { asContact, resolveHubToken } from "@/lib/services/hub";
import { addFeedback, clientDecision } from "@/lib/services/review";
import { decideChangeRequest, submitClientRequest } from "@/lib/services/scope";
import { UserError } from "@/lib/services/core";

// Every hub action re-resolves the token and checks the item belongs to the
// contact's company, so a link only ever acts on that client's own work.
async function contactFor(fd: FormData) {
  const contact = await resolveHubToken(str(fd, "token"));
  if (!contact) notFound();
  return contact;
}

export async function hubDecisionAction(fd: FormData) {
  const contact = await contactFor(fd);
  const id = str(fd, "deliverable_id");
  await act(`/hub/${str(fd, "token")}/review/${id}`, () =>
    asContact(contact, async (tx) => {
      const owns = await tx.one("select 1 from deliverables d join jobs j on j.id = d.job_id where d.id = $1 and j.company_id = $2", [id, contact.company_id]);
      if (!owns) throw new UserError("Not found.");
      await clientDecision(tx, id, {
        decision: str(fd, "decision") === "approved" ? "approved" : "changes_requested",
        channel: "hub",
        contactId: contact.id,
        approverName: contact.name,
        note: str(fd, "note"),
        versionId: str(fd, "version_id"),
      });
    }),
  str(fd, "decision") === "approved" ? "Approved — thank you. The team has been notified." : "Thanks — your feedback is with the team.");
}

export async function hubCommentAction(fd: FormData) {
  const contact = await contactFor(fd);
  const id = str(fd, "deliverable_id");
  await act(`/hub/${str(fd, "token")}/review/${id}`, () =>
    asContact(contact, async (tx) => {
      const owns = await tx.one("select 1 from deliverables d join jobs j on j.id = d.job_id where d.id = $1 and j.company_id = $2", [id, contact.company_id]);
      if (!owns) throw new UserError("Not found.");
      await addFeedback(tx, {
        deliverableId: id,
        versionId: str(fd, "version_id"),
        body: str(fd, "body"),
        channel: "hub",
        authorName: contact.name,
        contactId: contact.id,
        pinX: str(fd, "pin_x") ? num(fd, "pin_x") : null,
        pinY: str(fd, "pin_y") ? num(fd, "pin_y") : null,
        timecode: str(fd, "timecode") ? num(fd, "timecode") : null,
      });
    }),
  "Comment added.");
}

export async function hubChangeDecisionAction(fd: FormData) {
  const contact = await contactFor(fd);
  const id = str(fd, "change_request_id");
  await act(`/hub/${str(fd, "token")}/change/${id}`, () =>
    asContact(contact, async (tx) => {
      if (contact.role !== "approver") throw new UserError("Only named approvers can decide on change requests.");
      const owns = await tx.one("select 1 from change_requests where id = $1 and company_id = $2", [id, contact.company_id]);
      if (!owns) throw new UserError("Not found.");
      await decideChangeRequest(tx, id, { decision: str(fd, "decision") === "approved" ? "approved" : "declined", channel: "hub", contactId: contact.id, approverName: contact.name, note: str(fd, "note") });
    }),
  "Thanks, your decision is recorded.");
}

export async function hubRequestAction(fd: FormData) {
  const contact = await contactFor(fd);
  await act(`/hub/${str(fd, "token")}`, () =>
    asContact(contact, async (tx) => void (await submitClientRequest(tx, { company_id: contact.company_id, contact_id: contact.id, body: str(fd, "body"), channel: "hub" }))),
  "Request received. Your account manager will confirm timing and whether it's in scope.");
}

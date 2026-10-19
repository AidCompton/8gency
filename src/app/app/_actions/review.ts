"use server";
import { act, num, opt, str } from "@/lib/actions";
import { requireUser, tenant } from "@/lib/auth";
import { assertCan } from "@/lib/permissions";
import { addFeedback, clientDecision, createDeliverable, internalDecision, sendForInternalReview, sendToClient, uploadVersion } from "@/lib/services/review";
import { UserError } from "@/lib/services/core";

export async function createDeliverableAction(fd: FormData) {
  const user = await requireUser();
  const jobId = str(fd, "job_id");
  await act(`/app/jobs/${jobId}?tab=review`, () =>
    tenant(user, async (tx) => {
      const id = await createDeliverable(tx, { job_id: jobId, name: str(fd, "name"), scope_item_id: opt(fd, "scope_item_id"), approver_contact_id: opt(fd, "approver_contact_id"), due_date: opt(fd, "due_date") });
      const file = fd.get("file");
      if (file instanceof File && file.size > 0) await uploadVersion(tx, id, file, str(fd, "notes"));
      return `/app/deliverables/${id}`;
    }),
  );
}

export async function uploadVersionAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "deliverable_id");
  await act(`/app/deliverables/${id}`, () =>
    tenant(user, async (tx) => {
      const file = fd.get("file");
      if (!(file instanceof File)) throw new UserError("Choose a file.");
      await uploadVersion(tx, id, file, str(fd, "notes"));
    }),
  "New version uploaded.");
}

export async function internalReviewAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "deliverable_id");
  await act(`/app/deliverables/${id}`, () => tenant(user, (tx) => sendForInternalReview(tx, id)), "Sent for internal review.");
}

export async function internalDecisionAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "approveInternal");
  const id = str(fd, "deliverable_id");
  await act(`/app/deliverables/${id}`, () => tenant(user, (tx) => internalDecision(tx, id, str(fd, "decision") === "approved" ? "approved" : "changes_requested", str(fd, "note"))));
}

export async function sendToClientAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "deliverable_id");
  await act(`/app/deliverables/${id}`, () =>
    tenant(user, async (tx) => {
      const r = await sendToClient(tx, id, { absorbReason: str(fd, "absorb_reason"), requestChange: str(fd, "rounds_choice") === "change_request" });
      if (r.needsChangeRequest) {
        throw new UserError(`All ${r.needsChangeRequest.allowed} review round(s) in scope are used. Raise a change request for the extra round, or absorb it with a reason.`);
      }
      if (!r.sent) return `/app/deliverables/${id}?ok=${encodeURIComponent("Rounds used up: a change request for the extra round is drafted in Scope Guard.")}`;
    }),
  "Sent to the client by hub link, email and WhatsApp.");
}

export async function recordClientDecisionAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "sendChangeRequests");
  const id = str(fd, "deliverable_id");
  await act(`/app/deliverables/${id}`, () =>
    tenant(user, (tx) =>
      clientDecision(tx, id, {
        decision: str(fd, "decision") === "approved" ? "approved" : "changes_requested",
        channel: "app",
        contactId: null,
        approverName: `${str(fd, "approver_name") || "Client"} (recorded by ${user.name})`,
        note: str(fd, "note"),
      }),
    ),
  );
}

export async function addFeedbackAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "deliverable_id");
  await act(`/app/deliverables/${id}`, () =>
    tenant(user, (tx) =>
      addFeedback(tx, {
        deliverableId: id,
        versionId: str(fd, "version_id"),
        body: str(fd, "body"),
        channel: "app",
        authorName: user.name,
        pinX: str(fd, "pin_x") ? num(fd, "pin_x") : null,
        pinY: str(fd, "pin_y") ? num(fd, "pin_y") : null,
        timecode: str(fd, "timecode") ? num(fd, "timecode") : null,
      }),
    ),
  );
}

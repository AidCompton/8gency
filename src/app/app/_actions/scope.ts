"use server";
import { act, num, opt, str } from "@/lib/actions";
import { requireUser, tenant } from "@/lib/auth";
import { toCents } from "@/lib/domain/money";
import { assertCan } from "@/lib/permissions";
import {
  absorbChangeRequest, createChangeRequest, decideChangeRequest, dismissRequest, sendChangeRequest, submitClientRequest, triageAsChangeRequest, triageAsTask,
} from "@/lib/services/scope";

const back = (fd: FormData, d = "/app/scope") => str(fd, "back") || d;

export async function createChangeRequestAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "createChangeRequests");
  await act(back(fd), () =>
    tenant(user, async (tx) => {
      const jobId = opt(fd, "job_id");
      const job = jobId ? await tx.one<{ company_id: string; retainer_id: string | null }>("select company_id, retainer_id from jobs where id = $1", [jobId]) : null;
      const id = await createChangeRequest(tx, {
        company_id: job?.company_id ?? str(fd, "company_id"),
        job_id: jobId,
        retainer_id: job?.retainer_id ?? opt(fd, "retainer_id"),
        title: str(fd, "title"),
        description: str(fd, "description"),
        estimate_hours: num(fd, "estimate_hours"),
        price_cents: toCents(str(fd, "price")),
        origin: "manual",
      });
      return `/app/scope/${id}`;
    }),
  );
}

export async function updateChangeRequestAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "createChangeRequests");
  const id = str(fd, "id");
  await act(`/app/scope/${id}`, () =>
    tenant(user, async (tx) => {
      const before = await tx.one("select title, description, estimate_hours, price_cents, status from change_requests where id = $1", [id]);
      await tx.q("update change_requests set title=$2, description=$3, estimate_hours=$4, price_cents=$5 where id=$1 and status='draft'", [
        id, str(fd, "title"), str(fd, "description"), num(fd, "estimate_hours"), toCents(str(fd, "price")),
      ]);
      await tx.audit("change_request.updated", "change_request", id, before, { title: str(fd, "title"), price_cents: toCents(str(fd, "price")) });
    }),
  "Saved.");
}

export async function sendChangeRequestAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "sendChangeRequests");
  const id = str(fd, "id");
  await act(`/app/scope/${id}`, () => tenant(user, (tx) => sendChangeRequest(tx, id)), "Sent to the client's approvers by hub link, email and WhatsApp.");
}

export async function absorbChangeRequestAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "sendChangeRequests");
  const id = str(fd, "id");
  await act(`/app/scope/${id}`, () => tenant(user, (tx) => absorbChangeRequest(tx, id, str(fd, "reason"))), "Recorded as absorbed. It shows in the owner's giveaway report.");
}

/** Record a decision the client gave verbally or in a meeting, on their behalf. */
export async function recordDecisionAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "sendChangeRequests");
  const id = str(fd, "id");
  await act(`/app/scope/${id}`, () =>
    tenant(user, (tx) =>
      decideChangeRequest(tx, id, { decision: str(fd, "decision") === "approved" ? "approved" : "declined", channel: "app", approverName: `${str(fd, "approver_name") || "Client"} (recorded by ${user.name})`, userId: user.id, note: str(fd, "note") }),
    ),
  );
}

export async function triageTaskAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "triage");
  await act(back(fd), () =>
    tenant(user, async (tx) => {
      const [jobId, scopeId] = str(fd, "job_scope").split(":");
      await triageAsTask(tx, str(fd, "request_id"), { job_id: jobId, scope_item_id: scopeId || null, assignee_id: opt(fd, "assignee_id"), due_date: opt(fd, "due_date"), title: str(fd, "title") });
    }),
  "Accepted as in-scope work.");
}

export async function triageChangeAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "triage");
  await act(back(fd), () =>
    tenant(user, async (tx) => {
      const id = await triageAsChangeRequest(tx, str(fd, "request_id"), { job_id: opt(fd, "job_id"), title: str(fd, "title"), estimate_hours: num(fd, "estimate_hours") });
      return `/app/scope/${id}`;
    }),
  "Change request drafted. Check the price and send it.");
}

export async function dismissRequestAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "triage");
  await act(back(fd), () => tenant(user, (tx) => dismissRequest(tx, str(fd, "request_id"))));
}

/** Capture a request someone received by phone or in a meeting, so it goes through triage too. */
export async function logRequestAction(fd: FormData) {
  const user = await requireUser();
  await act(back(fd), () =>
    tenant(user, async (tx) => {
      await submitClientRequest(tx, { company_id: str(fd, "company_id"), job_id: opt(fd, "job_id"), body: str(fd, "body"), channel: "app" });
    }),
  "Request added to triage.");
}

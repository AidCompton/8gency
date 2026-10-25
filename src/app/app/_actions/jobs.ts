"use server";
import { sanitiseItem, type DraftItem } from "@/lib/domain/scopeDraft";
import { draftScope, saveScopeDraft, type ScopeDraft } from "@/lib/services/scopeDraft";
import { act, bool, num, opt, str } from "@/lib/actions";
import { requireUser, tenant } from "@/lib/auth";
import { toCents } from "@/lib/domain/money";
import { assertCan, can } from "@/lib/permissions";
import { addTask, closeJob, completeMilestone, createJob, lockScope, setJobBillTime, setJobStatus, setTaskStatus, type JobStatus } from "@/lib/services/jobs";
import { addScopeItem, removeScopeItem } from "@/lib/services/scope";
import { UserError } from "@/lib/services/core";

const back = (fd: FormData, d: string) => str(fd, "back") || d;

export async function createJobAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  await act("/app/jobs/new", () =>
    tenant(user, async (tx) => {
      const id = await createJob(tx, {
        company_id: str(fd, "company_id"),
        name: str(fd, "name"),
        template_key: str(fd, "template_key") || "blank",
        billing_model: (str(fd, "billing_model") || undefined) as "fixed" | "tm" | "retainer" | "internal" | undefined,
        retainer_id: opt(fd, "retainer_id"),
        owner_id: opt(fd, "owner_id"),
        start_date: opt(fd, "start_date"),
        due_date: opt(fd, "due_date"),
        fee_cents: toCents(str(fd, "fee")),
        budget_hours: str(fd, "budget_hours") ? num(fd, "budget_hours") : undefined,
        rush: bool(fd, "rush"),
        // "auto" = on for hourly (T&M) jobs, off otherwise.
        bill_time: str(fd, "bill_time") === "yes" ? true : str(fd, "bill_time") === "no" ? false : undefined,
      });
      return `/app/jobs/${id}?tab=brief`;
    }),
  "Job created. Complete the brief and approve the scope to start work.");
}

export async function setJobStatusAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  const id = str(fd, "job_id");
  await act(back(fd, `/app/jobs/${id}`), () => tenant(user, (tx) => setJobStatus(tx, id, str(fd, "status") as JobStatus, { overrideReason: str(fd, "override_reason") })));
}

export async function lockScopeAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  const id = str(fd, "job_id");
  await act(`/app/jobs/${id}?tab=scope`, () => tenant(user, (tx) => lockScope(tx, id)), "Scope baseline approved and locked.");
}

export async function closeJobAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  const id = str(fd, "job_id");
  await act(`/app/jobs/${id}`, () =>
    tenant(user, (tx) =>
      closeJob(tx, id, { on_time: str(fd, "on_time") === "yes", on_budget: str(fd, "on_budget") === "yes", rating: num(fd, "rating") || null, lessons: str(fd, "lessons") }),
    ),
  "Job closed.");
}

export async function updateJobAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  const id = str(fd, "job_id");
  await act(`/app/jobs/${id}?tab=overview`, () =>
    tenant(user, async (tx) => {
      const before = await tx.one("select name, owner_id, due_date, budget_hours, fee_cents, rush from jobs where id = $1", [id]);
      const after = { name: str(fd, "name"), owner_id: opt(fd, "owner_id"), due_date: opt(fd, "due_date"), budget_hours: num(fd, "budget_hours"), fee_cents: toCents(str(fd, "fee")), rush: bool(fd, "rush") };
      if (!after.name) throw new UserError("Job name is required.");
      await tx.q("update jobs set name=$2, owner_id=$3, due_date=$4, budget_hours=$5, fee_cents=$6, rush=$7 where id=$1", [id, after.name, after.owner_id, after.due_date, after.budget_hours, after.fee_cents, after.rush]);
      await tx.audit("job.updated", "job", id, before, after);
    }),
  "Saved.");
}

export async function saveBriefAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "job_id");
  await act(`/app/jobs/${id}?tab=brief`, () =>
    tenant(user, async (tx) => {
      await tx.q(
        `update briefs set objective=$2, audience=$3, key_message=$4, deliverables=$5, must_haves=$6, budget=$7, deadline=$8,
                approver_contact_id=$9, success_measure=$10, references_text=$11, updated_at=now() where job_id=$1`,
        [id, str(fd, "objective"), str(fd, "audience"), str(fd, "key_message"), str(fd, "deliverables"), str(fd, "must_haves"), str(fd, "budget"), opt(fd, "deadline"), opt(fd, "approver_contact_id"), str(fd, "success_measure"), str(fd, "references_text")],
      );
    }),
  "Brief saved.");
}

export async function signOffBriefAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "job_id");
  await act(`/app/jobs/${id}?tab=brief`, () =>
    tenant(user, async (tx) => {
      await tx.q("update briefs set signed_off_at = now(), signed_off_by = $2 where job_id = $1", [id, user.name]);
      await tx.audit("brief.signed_off", "job", id);
    }),
  "Brief signed off internally.");
}

export async function addScopeItemAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  const jobId = opt(fd, "job_id");
  const retainerId = opt(fd, "retainer_id");
  await act(back(fd, jobId ? `/app/jobs/${jobId}?tab=scope` : `/app/retainers/${retainerId}`), () =>
    tenant(user, (tx) =>
      addScopeItem(tx, {
        company_id: str(fd, "company_id"),
        job_id: jobId,
        retainer_id: retainerId,
        name: str(fd, "name"),
        unit: str(fd, "unit") === "hours" ? "hours" : "deliverable",
        quantity: num(fd, "quantity") || 1,
        rounds_allowed: num(fd, "rounds_allowed"),
        inclusions: str(fd, "inclusions"),
        exclusions: str(fd, "exclusions"),
      }),
    ),
  );
}

export async function removeScopeItemAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  await act(back(fd, "/app/jobs"), () => tenant(user, (tx) => removeScopeItem(tx, str(fd, "id"))));
}

export async function addTaskAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  const id = str(fd, "job_id");
  const scope = str(fd, "scope_item_id");
  await act(back(fd, `/app/jobs/${id}?tab=tasks`), () =>
    tenant(user, async (tx) => {
      await addTask(tx, {
        job_id: id,
        title: str(fd, "title"),
        assignee_id: opt(fd, "assignee_id"),
        due_date: opt(fd, "due_date"),
        estimate_hours: num(fd, "estimate_hours"),
        scope_item_id: scope && scope !== "oos" ? scope : null,
        out_of_scope: scope === "oos",
      });
    }),
  );
}

export async function setTaskStatusAction(fd: FormData) {
  const user = await requireUser();
  await act(back(fd, "/app/my-day"), () => tenant(user, (tx) => setTaskStatus(tx, str(fd, "task_id"), str(fd, "status"), str(fd, "blocked_reason"))));
}

export async function completeMilestoneAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  await act(back(fd, "/app/jobs"), () => tenant(user, (tx) => completeMilestone(tx, str(fd, "id"))), "Milestone complete: it's now in finance's ready-to-bill queue.");
}

export async function addCostAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  const id = str(fd, "job_id");
  await act(`/app/jobs/${id}?tab=money`, () =>
    tenant(user, async (tx) => {
      const amount = toCents(str(fd, "amount"));
      if (amount <= 0 || !str(fd, "description")) throw new UserError("Add a description and amount.");
      await tx.q("insert into costs (agency_id, job_id, supplier, description, amount_cents, incurred_on, rebillable, markup) values ($1,$2,$3,$4,$5,coalesce($6::date, current_date),$7,$8)", [
        tx.agencyId, id, str(fd, "supplier"), str(fd, "description"), amount, opt(fd, "incurred_on"), bool(fd, "rebillable"), num(fd, "markup") / 100,
      ]);
      await tx.audit("cost.created", "job", id, undefined, { amount, description: str(fd, "description") });
    }),
  "Cost added.");
}

/** Turn a job's time billing on (from today, or including time already logged) or off. */
export async function setJobBillTimeAction(fd: FormData) {
  const user = await requireUser();
  if (!can(user, "billing")) assertCan(user, "manageJobs");
  const id = str(fd, "job_id");
  const mode = str(fd, "mode") as "off" | "from_today" | "all";
  await act(
    `/app/jobs/${id}?tab=time`,
    () => {
      if (!["off", "from_today", "all"].includes(mode)) throw new UserError("Choose how to bill this job's time.");
      return tenant(user, (tx) => setJobBillTime(tx, id, mode));
    },
    mode === "off" ? "This job's time is no longer billed to the client." : "Billable time on this job now goes onto the client's next invoice automatically.",
  );
}

// ── Drafting scope from a quote (called from the job's Scope tab) ──

export async function draftScopeAction(jobId: string, text: string): Promise<{ draft?: ScopeDraft; error?: string }> {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  try {
    return { draft: await tenant(user, (tx) => draftScope(tx, jobId, text)) };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export async function saveScopeDraftAction(jobId: string, items: DraftItem[]): Promise<{ error?: string }> {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  try {
    const clean = items.map((i) => sanitiseItem(i)).filter((i): i is DraftItem => Boolean(i));
    await tenant(user, (tx) => saveScopeDraft(tx, jobId, clean));
    return {};
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

import { ScopeDrafter } from "@/components/ScopeDrafter";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addCostAction, addScopeItemAction, addTaskAction, closeJobAction, completeMilestoneAction, lockScopeAction, removeScopeItemAction,
  saveBriefAction, setJobBillTimeAction, setJobStatusAction, setTaskStatusAction, signOffBriefAction, updateJobAction,
} from "../../_actions/jobs";
import { SubmitButton } from "@/components/SubmitButton";
import { createDeliverableAction } from "../../_actions/review";
import { createChangeRequestAction, logRequestAction } from "../../_actions/scope";
import { logTimeAction, startTimerAction } from "../../_actions/time";
import { LockSimple, Play } from "@phosphor-icons/react/ssr";
import { Badge, Card, Empty, Field, Hours, Meter, Money, PageHeader, Pct, Stat, StatusBadge, Table, Tabs, Td, buttonClass, StatusIcon } from "@/components/ui";
import { requireUser, tenant, type SessionUser } from "@/lib/auth";
import type { Tx } from "@/lib/db";
import { BRIEF_FIELDS } from "@/lib/domain/brief";
import { formatDate, formatShort, todayIn } from "@/lib/domain/dates";
import { findVagueScope } from "@/lib/domain/scope";
import { can } from "@/lib/permissions";
import { agencySettings } from "@/lib/services/core";
import { briefScoreFor, getJob, jobFinancials } from "@/lib/services/jobs";
import { scopeUsage } from "@/lib/services/scope";
import { TIME_CATEGORIES } from "@/lib/services/time";

export const metadata = { title: "Job" };

type Job = NonNullable<Awaited<ReturnType<typeof getJob>>>;

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const tab = (await searchParams).tab ?? "overview";
  const user = await requireUser();
  const result = await tenant(user, async (tx) => {
    const job = await getJob(tx, id);
    if (!job) return null;
    if (!can(user, "seeAllJobs")) {
      const mine = await tx.one("select 1 from tasks where job_id = $1 and assignee_id = $2 union select 1 from jobs where id = $1 and owner_id = $2", [id, user.id]);
      if (!mine) return null;
    }
    const settings = await agencySettings(tx);
    return {
      job,
      settings,
      fin: await jobFinancials(tx, id),
      brief: await briefScoreFor(tx, id),
      scope: await scopeUsage(tx, { jobId: id }),
      body: await renderTab(tab, tx, job, user),
    };
  });
  if (!result) notFound();
  const { job, fin, brief, settings } = result;
  const money = can(user, "seeMargins");
  const manage = can(user, "manageJobs");
  const base = `/app/jobs/${id}`;
  return (
    <>
      <PageHeader
        back={{ href: "/app/jobs", label: "Jobs" }}
        title={<span className="flex flex-wrap items-center gap-2">{job.number} <span className="font-normal text-ink-2">{job.name}</span> <StatusBadge status={job.status} />{job.rush && <Badge tone="critical">Rush</Badge>}</span>}
        subtitle={<><Link className="hover:underline" href={`/app/clients/${job.company_id}`}>{job.company_name}</Link> · {job.billing_model === "tm" ? "Time and materials" : job.billing_model === "retainer" ? `Retainer: ${job.retainer_name}` : job.billing_model === "internal" ? "Internal" : "Fixed fee"} · Owner {job.owner_name ?? "—"} · Due {formatDate(job.due_date)}{job.bill_time && <> · <Link className="text-brand hover:underline" href={`/app/jobs/${job.id}?tab=time`}>Time billed to client</Link></>}</>}
        actions={
          <form action={startTimerAction}>
            <input type="hidden" name="job_id" value={id} />
            <input type="hidden" name="back" value={base} />
            <SubmitButton className={buttonClass("secondary", "sm")}><Play aria-hidden size={14} weight="fill" /> Start timer on job</SubmitButton>
          </form>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Hours used" value={<><Hours h={fin.hoursUsed} /> <span className="text-sm font-normal text-ink-3">/ {fin.budgetHours}h</span></>} hint={`Forecast to complete ${Math.round(fin.forecastHours)}h`} tone={fin.forecastHours > fin.budgetHours && fin.budgetHours > 0 ? "warning" : undefined} />
        <Stat label="Brief score" value={`${brief.score}/100`} hint={brief.score >= settings.brief_threshold ? "Ready for work" : `Below threshold of ${settings.brief_threshold}`} tone={brief.score >= settings.brief_threshold ? "good" : "warning"} href={`${base}?tab=brief`} />
        {money ? (
          <>
            <Stat label="Revenue" value={<Money cents={fin.revenue} compact />} hint={<>Invoiced <Money cents={fin.invoiced} compact /></>} />
            <Stat label="Margin" value={<Pct n={fin.margin} />} hint={<>Labour <Money cents={fin.labourCost} compact visible={can(user, "seeCostRates")} />{fin.absorbedValue > 0 && <> · absorbed <Money cents={fin.absorbedValue} compact /></>}</>} tone={fin.margin !== null && fin.margin < 0.2 ? "critical" : "good"} />
          </>
        ) : (
          <>
            <Stat label="Scope items" value={result.scope.length} hint={job.scope_locked_at ? "Baseline approved" : "Baseline not approved"} />
            <Stat label="Budget burn" value={<Pct n={fin.hoursBurn} />} hint="Hours used ÷ budget" />
          </>
        )}
      </div>
      {job.budget_hours > 0 && <div className="mb-5"><Meter value={fin.hoursUsed} max={fin.budgetHours} label="Budget burn" sublabel={`${Math.round((fin.hoursBurn ?? 0) * 100)}% of hours`} /></div>}
      <Tabs
        base={base}
        active={tab}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "brief", label: `Brief · ${brief.score}` },
          { key: "scope", label: job.scope_locked_at ? <span className="inline-flex items-center gap-1">Scope <StatusIcon tone="good" /><span className="sr-only"> (locked)</span></span> : "Scope" },
          { key: "tasks", label: "Tasks" },
          { key: "review", label: "Review" },
          { key: "time", label: "Time" },
          ...(money || manage ? [{ key: "money", label: "Money" }] : []),
        ]}
      />
      {result.body}
    </>
  );

  async function renderTab(t: string, tx: Tx, job: Job, user: SessionUser) {
    switch (t) {
      case "brief":
        return briefTab(tx, job);
      case "scope":
        return scopeTab(tx, job, user);
      case "tasks":
        return tasksTab(tx, job, user);
      case "review":
        return reviewTab(tx, job);
      case "time":
        return timeTab(tx, job, user);
      case "money":
        return moneyTab(tx, job, user);
      default:
        return overviewTab(tx, job, user);
    }
  }
}

async function overviewTab(tx: Tx, job: Job, user: SessionUser) {
  const manage = can(user, "manageJobs");
  const users = await tx.q<{ id: string; name: string }>("select id, name from users where active order by name");
  const milestones = await tx.q<{ id: string; name: string; amount_cents: number; status: string; trigger: string; due_date: string | null }>(
    "select id, name, amount_cents, status, trigger, due_date from milestones where job_id = $1 order by sort",
    [job.id],
  );
  const settings = await agencySettings(tx);
  const nextStatuses: Record<string, string[]> = {
    briefing: ["in_progress"],
    in_progress: ["waiting_client", "complete"],
    waiting_client: ["in_progress", "complete"],
    complete: ["in_progress"],
    closed: [],
  };
  const { score } = await briefScoreFor(tx, job.id);
  const needsOverride = job.status === "briefing" && score < settings.brief_threshold && !job.brief_override_reason;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {manage && job.status !== "closed" && (
        <Card title="Move the job forward">
          <form action={setJobStatusAction} className="space-y-3">
            <input type="hidden" name="job_id" value={job.id} />
            {needsOverride && (
              <Field label={`Brief scores ${score}/100 (threshold ${settings.brief_threshold}). Override reason`} hint="Recorded in the audit log. Or complete the brief first.">
                <input name="override_reason" placeholder="e.g. Client confirmed missing items verbally; follow up in writing" />
              </Field>
            )}
            {job.status === "briefing" && !job.scope_locked_at && job.billing_model !== "internal" && (
              <p className="flex items-start gap-1.5 text-sm text-warning-ink"><StatusIcon tone="warning" /> Approve the scope baseline on the Scope tab before starting work.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {nextStatuses[job.status].map((s) => (
                <SubmitButton key={s} name="status" value={s} className={buttonClass(s === "complete" ? "primary" : "secondary", "sm")}>
                  {s === "in_progress" ? (job.status === "briefing" ? "Start work" : "Back to in progress") : s === "waiting_client" ? "Waiting on client" : "Mark complete"}
                </SubmitButton>
              ))}
            </div>
          </form>
          {job.brief_override_reason && <p className="mt-3 text-xs text-ink-3">Brief override recorded: “{job.brief_override_reason}”</p>}
        </Card>
      )}
      {job.status === "complete" && manage && (
        <Card title="Close-out review (required to close)">
          <form action={closeJobAction} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="job_id" value={job.id} />
            <Field label="On time?"><select name="on_time"><option value="yes">Yes</option><option value="no">No</option></select></Field>
            <Field label="On budget?"><select name="on_budget"><option value="yes">Yes</option><option value="no">No</option></select></Field>
            <Field label="Client rating"><select name="rating" defaultValue=""><option value="">—</option>{[5, 4, 3, 2, 1].map((n) => <option key={n}>{n}</option>)}</select></Field>
            <Field label="Lessons learned" className="sm:col-span-3"><textarea name="lessons" required /></Field>
            <div><SubmitButton className={buttonClass("primary", "sm")}>Close job</SubmitButton></div>
          </form>
        </Card>
      )}
      {job.status === "closed" && (
        <Card title="Close-out">
          <p className="text-sm">On time: <b>{job.closeout_on_time ? "yes" : "no"}</b> · On budget: <b>{job.closeout_on_budget ? "yes" : "no"}</b> · Rating: <b>{job.closeout_rating ?? "—"}</b></p>
          <p className="mt-2 text-sm text-ink-2">{job.closeout_lessons}</p>
        </Card>
      )}
      {milestones.length > 0 && (
        <Card title="Billing schedule">
          <ul className="divide-y divide-line text-sm">
            {milestones.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <span>{m.name} <span className="text-xs text-ink-3">· {m.trigger === "manual" ? "on sign-off" : `on ${m.trigger}`}</span></span>
                <span className="flex items-center gap-2">
                  <Money cents={m.amount_cents} visible={can(user, "seeMargins")} />
                  <StatusBadge status={m.status === "complete" ? "approved" : m.status === "invoiced" ? "paid" : "draft"} />
                  {m.status === "pending" && manage && (
                    <form action={completeMilestoneAction}>
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="back" value={`/app/jobs/${job.id}`} />
                      <SubmitButton className={buttonClass("ghost", "sm")}>Mark reached</SubmitButton>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-3">Reached milestones go straight to finance's ready-to-bill queue.</p>
        </Card>
      )}
      {manage && (
        <Card title="Job details">
          <form action={updateJobAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="job_id" value={job.id} />
            <Field label="Name" className="sm:col-span-2"><input name="name" defaultValue={job.name} /></Field>
            <Field label="Owner"><select name="owner_id" defaultValue={job.owner_id ?? ""}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            <Field label="Due date"><input type="date" name="due_date" defaultValue={job.due_date ?? ""} /></Field>
            <Field label="Budget hours"><input name="budget_hours" defaultValue={job.budget_hours} /></Field>
            <Field label="Fee (excl. VAT)"><input name="fee" defaultValue={(job.fee_cents / 100).toFixed(2)} /></Field>
            <label className="flex items-center gap-2"><input type="checkbox" name="rush" defaultChecked={job.rush} /> Rush</label>
            <div className="sm:col-span-2"><SubmitButton className={buttonClass("secondary", "sm")}>Save</SubmitButton></div>
          </form>
        </Card>
      )}
      <Card title="Log a request from the client">
        <form action={logRequestAction} className="space-y-2">
          <input type="hidden" name="company_id" value={job.company_id} />
          <input type="hidden" name="job_id" value={job.id} />
          <input type="hidden" name="back" value={`/app/jobs/${job.id}`} />
          <Field label="What did they ask for?" hint="Call, meeting, WhatsApp… It goes to triage, where Scope Guard checks it against scope."><textarea name="body" /></Field>
          <SubmitButton className={buttonClass("secondary", "sm")}>Send to triage</SubmitButton>
        </form>
      </Card>
    </div>
  );
}

async function briefTab(tx: Tx, job: Job) {
  const brief = await tx.one<Record<string, string | null> & { signed_off_at: Date | null; signed_off_by: string | null }>("select * from briefs where job_id = $1", [job.id]);
  const approvers = await tx.q<{ id: string; name: string; role: string }>("select id, name, role from contacts where company_id = $1 and active order by role, name", [job.company_id]);
  const { score, missing } = await briefScoreFor(tx, job.id);
  const settings = await agencySettings(tx);
  const field = (k: string) => (brief?.[k] as string | null) ?? "";
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card title="Brief">
        <form action={saveBriefAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="job_id" value={job.id} />
          <Field label="Objective" className="sm:col-span-2"><textarea name="objective" defaultValue={field("objective")} /></Field>
          <Field label="Audience"><textarea name="audience" defaultValue={field("audience")} /></Field>
          <Field label="Key message"><textarea name="key_message" defaultValue={field("key_message")} /></Field>
          <Field label="Deliverables (linked to scope)"><textarea name="deliverables" defaultValue={field("deliverables")} /></Field>
          <Field label="Must-haves"><textarea name="must_haves" defaultValue={field("must_haves")} /></Field>
          <Field label="Budget"><input name="budget" defaultValue={field("budget")} /></Field>
          <Field label="Deadline"><input type="date" name="deadline" defaultValue={field("deadline")} /></Field>
          <Field label="Named approver" hint={approvers.length ? undefined : "Add an approver on the client page."}>
            <select name="approver_contact_id" defaultValue={field("approver_contact_id")}>
              <option value="">—</option>
              {approvers.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
            </select>
          </Field>
          <Field label="Success measure"><input name="success_measure" defaultValue={field("success_measure")} /></Field>
          <Field label="References (brand kit, past work, research)" className="sm:col-span-2"><textarea name="references_text" defaultValue={field("references_text")} /></Field>
          <div className="sm:col-span-2"><SubmitButton className={buttonClass("primary", "sm")}>Save brief</SubmitButton></div>
        </form>
      </Card>
      <div className="space-y-4">
        <Card title="Completeness">
          <Meter value={score} max={100} label="Brief score" sublabel={`${score}/100`} warnAt={2} />
          <p className="mt-2 text-xs text-ink-3">Work can't start below {settings.brief_threshold} without a recorded override.</p>
          {missing.length > 0 && (
            <>
              <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-3">Questions to send the client</h3>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
                {missing.map((m) => <li key={m.key}><b>{m.label}:</b> {m.question}</li>)}
              </ol>
            </>
          )}
        </Card>
        <Card title="Sign-off">
          {brief?.signed_off_at ? (
            <p className="flex items-start gap-1.5 text-sm"><StatusIcon tone="good" /> Signed off by {brief.signed_off_by} on {formatDate(new Date(brief.signed_off_at).toISOString().slice(0, 10))}</p>
          ) : (
            <form action={signOffBriefAction}>
              <input type="hidden" name="job_id" value={job.id} />
              <SubmitButton className={buttonClass("secondary", "sm")}>Sign off internally</SubmitButton>
            </form>
          )}
        </Card>
        <Card title="Fields">
          <ul className="space-y-1 text-sm">
            {BRIEF_FIELDS.map((f) => <li key={f.key} className="flex justify-between"><span>{f.label}</span><span className={missing.some((m) => m.key === f.key) ? "text-warning-ink" : "text-good-ink"}>{missing.some((m) => m.key === f.key) ? <span className="inline-flex items-center gap-1"><StatusIcon tone="warning" /> missing</span> : <><StatusIcon tone="good" /><span className="sr-only">complete</span></>}</span></li>)}
          </ul>
        </Card>
      </div>
    </div>
  );
}

async function scopeTab(tx: Tx, job: Job, user: SessionUser) {
  const items = await scopeUsage(tx, { jobId: job.id });
  const aiOn = (await agencySettings(tx)).ai_enabled;
  const crs = await tx.q<{ id: string; title: string; status: string; price_cents: number; estimate_hours: number; created_at: Date }>(
    "select id, title, status, price_cents, estimate_hours, created_at from change_requests where job_id = $1 order by created_at desc",
    [job.id],
  );
  const manage = can(user, "manageJobs");
  const locked = Boolean(job.scope_locked_at);
  const vague = items.flatMap((i) => findVagueScope(`${i.name} ${i.inclusions}`).map((v) => ({ item: i.name, ...v })));
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card id="tour-scope" title={locked ? `Scope baseline · approved ${formatDate(new Date(job.scope_locked_at!).toISOString().slice(0, 10))}` : "Scope baseline · draft"} actions={!locked && manage && items.length > 0 && (
        <form action={lockScopeAction}><input type="hidden" name="job_id" value={job.id} /><SubmitButton className={buttonClass("primary", "sm")}>Approve and lock baseline</SubmitButton></form>
      )}>
        {items.length ? (
          <ul className="space-y-4">
            {items.map((i) => (
              <li key={i.id}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{i.name} {i.source === "change_request" && <Badge tone="info">change request</Badge>}</div>
                    <div className="text-xs text-ink-2">
                      {i.quantity} {i.unit === "hours" ? "hours" : "deliverable(s)"}{i.unit === "deliverable" ? ` · ${i.rounds_allowed} review round(s) each` : ""}
                      {i.inclusions && <> · Includes: {i.inclusions}</>}{i.exclusions && <> · Excludes: {i.exclusions}</>}
                    </div>
                  </div>
                  {!locked && manage && (
                    <form action={removeScopeItemAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="back" value={`/app/jobs/${job.id}?tab=scope`} /><SubmitButton confirm="Remove this scope item?" className={buttonClass("ghost", "sm")}>Remove</SubmitButton></form>
                  )}
                </div>
                <div className="mt-2"><Meter value={i.used} max={i.quantity} compact label={i.unit === "hours" ? "Hours used" : "Deliverables created"} sublabel={`${i.used} / ${i.quantity}${i.meter.over ? ` · ${i.meter.over} over` : ""}`} /></div>
              </li>
            ))}
          </ul>
        ) : <Empty>No scope items yet. Add what was sold: each deliverable or hours bank, with rounds, inclusions and exclusions.</Empty>}
        {!locked && manage && (
          <div className="mt-6 border-t border-line pt-4"><ScopeDrafter jobId={job.id} aiOn={aiOn} /></div>
        )}
        {!locked && manage && (
          <form action={addScopeItemAction} className="mt-6 grid gap-3 border-t border-line pt-4 sm:grid-cols-4">
            <input type="hidden" name="job_id" value={job.id} />
            <input type="hidden" name="company_id" value={job.company_id} />
            <Field label="Item" className="sm:col-span-2"><input name="name" required placeholder="e.g. 6 social statics" /></Field>
            <Field label="Unit"><select name="unit"><option value="deliverable">Deliverable</option><option value="hours">Hours</option></select></Field>
            <Field label="Quantity"><input name="quantity" defaultValue="1" /></Field>
            <Field label="Rounds each"><input name="rounds_allowed" defaultValue="2" /></Field>
            <Field label="Inclusions" className="sm:col-span-3"><input name="inclusions" /></Field>
            <Field label="Exclusions" className="sm:col-span-4"><input name="exclusions" /></Field>
            <div><SubmitButton className={buttonClass("secondary", "sm")}>Add to scope</SubmitButton></div>
          </form>
        )}
        {locked && <p className="mt-4 text-xs text-ink-3">The baseline is locked. Scope grows only through approved change requests, which add items here automatically.</p>}
      </Card>
      <div className="space-y-4">
        {vague.length > 0 && (
          <Card title={<span className="inline-flex items-center gap-1.5"><StatusIcon tone="warning" /> Vague scope wording</span>}>
            <ul className="space-y-2 text-sm">{vague.map((v, i) => <li key={i}><b>“{v.phrase}”</b> in {v.item}: {v.suggestion}</li>)}</ul>
          </Card>
        )}
        <Card title="Change requests">
          {crs.length ? (
            <ul className="space-y-2 text-sm">
              {crs.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <Link href={`/app/scope/${c.id}`} className="truncate hover:underline">{c.title}</Link>
                  <span className="flex shrink-0 items-center gap-2"><Money cents={c.price_cents} compact visible={can(user, "seeMargins")} /><StatusBadge status={c.status} /></span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-3">None yet.</p>}
          {can(user, "createChangeRequests") && (
            <form action={createChangeRequestAction} className="mt-4 space-y-2 border-t border-line pt-3">
              <input type="hidden" name="job_id" value={job.id} />
              <Field label="What's the extra work?"><input name="title" required /></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="Hours"><input name="estimate_hours" inputMode="decimal" /></Field><Field label="Price" hint="Blank = rate card"><input name="price" inputMode="decimal" /></Field></div>
              <SubmitButton className={buttonClass("secondary", "sm")}>Draft change request</SubmitButton>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

async function tasksTab(tx: Tx, job: Job, user: SessionUser) {
  const tasks = await tx.q<{ id: string; title: string; status: string; due_date: string | null; estimate_hours: number; assignee: string | null; scope: string | null; out_of_scope: boolean; change_request_id: string | null; logged: number }>(
    `select t.id, t.title, t.status, t.due_date, t.estimate_hours, u.name as assignee, s.name as scope, t.out_of_scope, t.change_request_id,
            coalesce((select sum(hours) from time_entries te where te.task_id = t.id),0) as logged
       from tasks t left join users u on u.id = t.assignee_id left join scope_items s on s.id = t.scope_item_id
      where t.job_id = $1 order by t.status = 'done', t.due_date nulls last, t.created_at`,
    [job.id],
  );
  const users = await tx.q<{ id: string; name: string }>("select id, name from users where active order by name");
  const scope = await tx.q<{ id: string; name: string }>("select id, name from scope_items where job_id = $1 order by created_at", [job.id]);
  const today = todayIn(user.timezone);
  return (
    <Card pad={false}>
      <Table head={["Task", "Assignee", "In scope", "Due", "Time", "Status", ""]} empty="No tasks yet.">
        {tasks.map((t) => (
          <tr key={t.id}>
            <Td className="max-w-[20rem]"><span className={t.status === "done" ? "text-ink-3 line-through" : ""}>{t.title}</span></Td>
            <Td className="text-ink-2">{t.assignee ?? "—"}</Td>
            <Td>{t.out_of_scope ? <Badge tone={t.change_request_id ? "info" : "critical"}>{t.change_request_id ? "CR" : "Out of scope"}</Badge> : <span className="text-xs text-ink-2">{t.scope ?? "—"}</span>}</Td>
            <Td className={t.due_date && t.due_date < today && t.status !== "done" ? "text-critical-ink" : "text-ink-2"}>{formatShort(t.due_date)}</Td>
            <Td right>{t.logged}h{t.estimate_hours ? ` / ${t.estimate_hours}h` : ""}</Td>
            <Td><StatusBadge status={t.status} /></Td>
            <Td>
              {t.status !== "done" && (
                <form action={setTaskStatusAction}>
                  <input type="hidden" name="task_id" value={t.id} />
                  <input type="hidden" name="back" value={`/app/jobs/${job.id}?tab=tasks`} />
                  <SubmitButton name="status" value="done" className={buttonClass("ghost", "sm")}>Done</SubmitButton>
                </form>
              )}
            </Td>
          </tr>
        ))}
      </Table>
      {can(user, "manageJobs") && job.status !== "closed" && (
        <form action={addTaskAction} className="grid gap-3 border-t border-line p-4 sm:grid-cols-6">
          <input type="hidden" name="job_id" value={job.id} />
          <Field label="New task" className="sm:col-span-2"><input name="title" required /></Field>
          <Field label="Assignee"><select name="assignee_id"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          <Field label="Scope item" hint="Out-of-scope work must become a change request or be absorbed."><select name="scope_item_id" required defaultValue=""><option value="" disabled>Choose…</option>{scope.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="oos">⚑ Out of scope</option></select></Field>
          <Field label="Due"><input type="date" name="due_date" /></Field>
          <Field label="Estimate (h)"><input name="estimate_hours" /></Field>
          <div><SubmitButton className={buttonClass("secondary", "sm")}>Add task</SubmitButton></div>
        </form>
      )}
    </Card>
  );
}

async function reviewTab(tx: Tx, job: Job) {
  const ds = await tx.q<{ id: string; name: string; status: string; rounds_used: number; extra_rounds: number; rounds_allowed: number | null; versions: number; sent_to_client_at: Date | null; scope: string | null }>(
    `select d.id, d.name, d.status, d.rounds_used, d.extra_rounds, s.rounds_allowed, s.name as scope, d.sent_to_client_at,
            (select count(*)::int from versions v where v.deliverable_id = d.id) as versions
       from deliverables d left join scope_items s on s.id = d.scope_item_id where d.job_id = $1 order by d.created_at`,
    [job.id],
  );
  const scope = await tx.q<{ id: string; name: string }>("select id, name from scope_items where job_id = $1 and unit = 'deliverable' order by created_at", [job.id]);
  const approvers = await tx.q<{ id: string; name: string }>("select id, name from contacts where company_id = $1 and role = 'approver' and active", [job.company_id]);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card pad={false}>
        <Table head={["Deliverable", "Scope item", "Versions", "Rounds", "Status"]} empty="No deliverables yet.">
          {ds.map((d) => {
            const allowed = (d.rounds_allowed ?? 2) + d.extra_rounds;
            return (
              <tr key={d.id}>
                <Td><Link href={`/app/deliverables/${d.id}`} className="font-medium hover:underline">{d.name}</Link></Td>
                <Td className="text-xs text-ink-2">{d.scope ?? "—"}</Td>
                <Td right>{d.versions}</Td>
                <Td className={d.rounds_used >= allowed ? "text-warning-ink" : ""}>{d.rounds_used} / {allowed}</Td>
                <Td><StatusBadge status={d.status} /></Td>
              </tr>
            );
          })}
        </Table>
      </Card>
      <Card title="New deliverable">
        <form action={createDeliverableAction} className="space-y-3">
          <input type="hidden" name="job_id" value={job.id} />
          <Field label="Name"><input name="name" required /></Field>
          <Field label="Scope item"><select name="scope_item_id"><option value="">—</option>{scope.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Client approver"><select name="approver_contact_id"><option value="">First approver on file</option>{approvers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="Due"><input type="date" name="due_date" /></Field>
          <Field label="First version (optional)"><input type="file" name="file" /></Field>
          <SubmitButton className={buttonClass("primary", "sm")}>Create</SubmitButton>
        </form>
      </Card>
    </div>
  );
}

async function timeTab(tx: Tx, job: Job, user: SessionUser) {
  const entries = await tx.q<{ id: string; work_date: string; hours: number; category: string; notes: string; name: string; task: string | null; out_of_scope: boolean; oos_resolution: string | null; locked: boolean; rate_cents: number; not_billed: boolean; source: string; invoice_id: string | null; invoice_number: string | null; invoice_status: string | null }>(
    `select te.id, te.work_date, te.hours, te.category, te.notes, u.name, t.title as task, te.out_of_scope, te.oos_resolution, te.locked, te.rate_cents,
            te.not_billed, te.source, i.id as invoice_id, i.number as invoice_number, i.status as invoice_status
       from time_entries te join users u on u.id = te.user_id left join tasks t on t.id = te.task_id
       left join invoice_lines l on l.id = te.invoice_line_id left join invoices i on i.id = l.invoice_id
      where te.job_id = $1 order by te.work_date desc, te.created_at desc limit 200`,
    [job.id],
  );
  const billing = (await tx.one<{ next_hours: number; next_value: number; invoiced_hours: number; unbilled_hours: number; unbilled_value: number; draft_id: string | null }>(
    `select coalesce(sum(te.hours) filter (where i.status = 'draft'), 0) as next_hours,
            coalesce(sum(te.hours * te.rate_cents) filter (where i.status = 'draft'), 0) as next_value,
            coalesce(sum(te.hours) filter (where i.status in ('sent', 'paid')), 0) as invoiced_hours,
            coalesce(sum(te.hours) filter (where te.invoice_line_id is null and te.category = 'billable' and not te.out_of_scope and not te.not_billed and te.source <> 'import'), 0) as unbilled_hours,
            coalesce(sum(te.hours * te.rate_cents) filter (where te.invoice_line_id is null and te.category = 'billable' and not te.out_of_scope and not te.not_billed and te.source <> 'import'), 0) as unbilled_value,
            (select id from invoices where company_id = $2 and status = 'draft' order by created_at limit 1) as draft_id
       from time_entries te left join invoice_lines l on l.id = te.invoice_line_id left join invoices i on i.id = l.invoice_id
      where te.job_id = $1`,
    [job.id, job.company_id],
  ))!;
  const canBill = can(user, "billing") || can(user, "manageJobs");
  const billingStatus = (e: (typeof entries)[number]) =>
    e.invoice_status === "draft" ? <Link className="text-brand hover:underline" href={`/app/billing/invoices/${e.invoice_id}`}>Next invoice</Link>
    : e.invoice_number ? <Link className="hover:underline" href={`/app/billing/invoices/${e.invoice_id}`}>{e.invoice_number}</Link>
    : e.not_billed ? <span className="text-ink-3">Not charged</span>
    : e.category !== "billable" ? <span className="text-ink-3">Not billable</span>
    : e.out_of_scope ? <span className="text-ink-3">Via change request</span>
    : e.source === "import" ? job.bill_time ? <Link className="text-ink-3 hover:underline" href="/app/billing?tab=ready">Imported · Ready to bill</Link> : <span className="text-ink-3">Imported</span>
    : job.bill_time && job.bill_time_from && e.work_date < job.bill_time_from ? <span className="text-ink-3">Before billing start</span>
    : job.bill_time ? <span className="text-ink-3">Pending</span>
    : <span className="text-ink-3">In job fee</span>;
  const tasks = await tx.q<{ id: string; title: string; out_of_scope: boolean }>("select id, title, out_of_scope from tasks where job_id = $1 and status <> 'done' order by title", [job.id]);
  const byPerson = await tx.q<{ name: string; hours: number }>("select u.name, sum(te.hours) as hours from time_entries te join users u on u.id = te.user_id where te.job_id = $1 group by u.name order by 2 desc", [job.id]);
  const money = can(user, "seeMargins");
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card pad={false}>
        <Table head={["Date", "Person", "Task", "Category", "Hours", ...(money ? ["Value"] : []), "Billing"]} empty="No time logged yet.">
          {entries.map((e) => (
            <tr key={e.id}>
              <Td className="text-ink-2">{formatShort(e.work_date)}</Td>
              <Td>{e.name}</Td>
              <Td className="max-w-[16rem] truncate text-ink-2">{e.task ?? e.notes ?? "—"} {e.out_of_scope && <Badge tone={e.oos_resolution === "absorbed" ? "warning" : "info"}>{e.oos_resolution === "absorbed" ? "absorbed" : "CR"}</Badge>}</Td>
              <Td className="text-xs text-ink-2">{e.category.replace(/_/g, " ")}</Td>
              <Td right><span className="inline-flex items-center gap-1">{e.hours}{e.locked && <><LockSimple aria-hidden size={12} className="text-ink-3" /><span className="sr-only"> (locked)</span></>}</span></Td>
              {money && <Td right><Money cents={e.hours * e.rate_cents} /></Td>}
              <Td className="whitespace-nowrap text-xs">{billingStatus(e)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <div className="space-y-4">
        <Card title="Time billing" actions={job.bill_time ? <Badge tone="good" dot>On</Badge> : <Badge dot>Off</Badge>}>
          {job.bill_time ? (
            <div className="space-y-3 text-sm">
              <p className="text-ink-2">
                Billable time goes onto {job.company_name}&apos;s next invoice as it&apos;s logged, itemised by task and role{job.bill_time_from ? <> (time from {formatDate(job.bill_time_from)})</> : null}.
              </p>
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-3"><dt className="text-ink-2">On the next invoice</dt><dd className="tnum font-medium">{Number(billing.next_hours)}h{money && <> · <Money cents={Math.round(billing.next_value)} /></>}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-ink-2">Already invoiced</dt><dd className="tnum">{Number(billing.invoiced_hours)}h</dd></div>
              </dl>
              <div className="flex flex-wrap gap-2">
                {billing.draft_id && <Link href={`/app/billing/invoices/${billing.draft_id}`} className={buttonClass("secondary", "sm")}>Open next invoice</Link>}
                {canBill && (
                  <form action={setJobBillTimeAction}>
                    <input type="hidden" name="job_id" value={job.id} />
                    <input type="hidden" name="mode" value="off" />
                    <SubmitButton confirm="Stop billing this job's time? Time already on the next invoice stays there until you remove it." className={buttonClass("ghost", "sm")}>Stop billing time</SubmitButton>
                  </form>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-ink-2">
                Time is tracked for budget and profitability{job.billing_model === "retainer" ? ", and counts against the retainer" : job.billing_model === "fixed" ? ", and is covered by the job fee" : ""}. It isn&apos;t charged to the client.
              </p>
              {canBill && (
                <form action={setJobBillTimeAction} className="flex flex-wrap gap-2">
                  <input type="hidden" name="job_id" value={job.id} />
                  <SubmitButton name="mode" value="from_today" className={buttonClass("primary", "sm")}>Bill time from today</SubmitButton>
                  {Number(billing.unbilled_hours) > 0 && (
                    <SubmitButton
                      name="mode"
                      value="all"
                      confirm={`Also bill the ${Number(billing.unbilled_hours)}h already logged on this job? It goes onto ${job.company_name}'s next invoice now.`}
                      className={buttonClass("secondary", "sm")}
                    >
                      Include {Number(billing.unbilled_hours)}h already logged{money && <> (<Money cents={Math.round(billing.unbilled_value)} compact />)</>}
                    </SubmitButton>
                  )}
                </form>
              )}
            </div>
          )}
        </Card>
        <Card title="Log time">
          <form action={logTimeAction} className="space-y-3">
            <input type="hidden" name="job_id" value={job.id} />
            <input type="hidden" name="back" value={`/app/jobs/${job.id}?tab=time`} />
            <Field label="Task"><select name="task_id"><option value="">Whole job</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.out_of_scope ? "⚑ " : ""}{t.title}</option>)}</select></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Date"><input type="date" name="work_date" defaultValue={todayIn(user.timezone)} /></Field>
              <Field label="Hours"><input name="hours" inputMode="decimal" required /></Field>
            </div>
            <Field label="Category"><select name="category" defaultValue="">{[{ key: "", label: "Default for job" }, ...TIME_CATEGORIES].map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></Field>
            <Field label="If the task is out of scope"><select name="oos_resolution" defaultValue="change_request"><option value="change_request">Draft a change request</option><option value="absorbed">Absorb with reason</option></select></Field>
            <Field label="Absorb reason"><input name="absorb_reason" /></Field>
            {job.status === "closed" && <Field label="Closed-job override reason"><input name="closed_job_override" required /></Field>}
            <Field label="Notes"><input name="notes" /></Field>
            <SubmitButton className={buttonClass("primary", "sm")}>Log time</SubmitButton>
          </form>
        </Card>
        <Card title="By person">
          <ul className="space-y-1 text-sm">{byPerson.map((p) => <li key={p.name} className="flex justify-between"><span>{p.name}</span><span className="tnum">{p.hours}h</span></li>)}</ul>
        </Card>
      </div>
    </div>
  );
}

async function moneyTab(tx: Tx, job: Job, user: SessionUser) {
  const fin = await jobFinancials(tx, job.id);
  const money = can(user, "seeMargins");
  const costs = await tx.q<{ id: string; supplier: string; description: string; amount_cents: number; rebillable: boolean; markup: number; incurred_on: string; invoice_line_id: string | null }>(
    "select id, supplier, description, amount_cents, rebillable, markup, incurred_on, invoice_line_id from costs where job_id = $1 order by incurred_on desc",
    [job.id],
  );
  const invoices = await tx.q<{ id: string; number: string | null; status: string; amount: number }>(
    `select i.id, i.number, i.status, sum(l.amount_cents) as amount from invoice_lines l join invoices i on i.id = l.invoice_id where l.job_id = $1 group by i.id order by i.created_at desc`,
    [job.id],
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {money && (
        <Card title="Job P&L">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-ink-2">Revenue (fee + approved changes + rebilled costs)</dt><dd className="text-right"><Money cents={fin.revenue} /></dd>
            <dt className="text-ink-2">Labour at cost</dt><dd className="text-right"><Money cents={fin.labourCost} visible={can(user, "seeCostRates")} /></dd>
            <dt className="text-ink-2">Direct costs</dt><dd className="text-right"><Money cents={fin.directCosts} /></dd>
            <dt className="font-medium">Margin</dt><dd className="text-right font-medium"><Pct n={fin.margin} /></dd>
            <dt className="text-ink-2">Time at standard rates</dt><dd className="text-right"><Money cents={fin.standardValue} /></dd>
            <dt className="text-ink-2">Approved change requests</dt><dd className="text-right"><Money cents={fin.approvedChangeValue} /></dd>
            <dt className="text-ink-2">Absorbed (given away)</dt><dd className="text-right text-warning-ink"><Money cents={fin.absorbedValue} /></dd>
            <dt className="text-ink-2">Invoiced so far</dt><dd className="text-right"><Money cents={fin.invoiced} /></dd>
          </dl>
        </Card>
      )}
      <Card title="Invoices">
        {invoices.length ? (
          <ul className="space-y-1 text-sm">
            {invoices.map((i) => <li key={i.id} className="flex justify-between"><Link className="hover:underline" href={`/app/billing/invoices/${i.id}`}>{i.number ?? "Draft"}</Link><span className="flex gap-2"><Money cents={i.amount} visible={money} /><StatusBadge status={i.status} /></span></li>)}
          </ul>
        ) : <p className="text-sm text-ink-3">Nothing invoiced yet.</p>}
      </Card>
      <Card title="Costs and pass-throughs" className="lg:col-span-2">
        <Table head={["Date", "Supplier", "Description", "Amount", "Rebill", "Billed"]} empty="No costs on this job.">
          {costs.map((c) => (
            <tr key={c.id}>
              <Td className="text-ink-2">{formatShort(c.incurred_on)}</Td>
              <Td>{c.supplier || "—"}</Td>
              <Td>{c.description}</Td>
              <Td right><Money cents={c.amount_cents} visible={money} /></Td>
              <Td>{c.rebillable ? `+${Math.round(c.markup * 100)}%` : "No"}</Td>
              <Td>{c.invoice_line_id ? <><StatusIcon tone="good" /><span className="sr-only">Invoiced</span></> : "—"}</Td>
            </tr>
          ))}
        </Table>
        <form action={addCostAction} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-6">
          <input type="hidden" name="job_id" value={job.id} />
          <Field label="Supplier"><input name="supplier" /></Field>
          <Field label="Description" className="sm:col-span-2"><input name="description" required /></Field>
          <Field label="Amount (excl. VAT)"><input name="amount" required /></Field>
          <Field label="Markup %"><input name="markup" defaultValue="15" /></Field>
          <label className="flex items-end gap-2 pb-2"><input type="checkbox" name="rebillable" defaultChecked /> Re-bill</label>
          <div><SubmitButton className={buttonClass("secondary", "sm")}>Add cost</SubmitButton></div>
        </form>
      </Card>
    </div>
  );
}

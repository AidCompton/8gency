import Link from "next/link";
import { setTaskStatusAction } from "../_actions/jobs";
import { startTimerAction } from "../_actions/time";
import { Badge, Card, Empty, Meter, PageHeader, buttonClass } from "@/components/ui";
import { requireUser, tenant } from "@/lib/auth";
import { formatShort } from "@/lib/domain/dates";
import { myDay, type MyDayTask } from "@/lib/services/myday";
import { currentTimer } from "@/lib/services/time";

export const metadata = { title: "My Day" };

function TaskCard({ t, running }: { t: MyDayTask; running: boolean }) {
  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-ink-3">
            <Link href={`/app/jobs/${t.job_id}`} className="hover:underline">{t.job_number}</Link> · {t.company_name}
          </div>
          <div className="mt-0.5 font-medium">{t.title}</div>
        </div>
        <div className="flex items-center gap-1.5">
          {t.out_of_scope && <Badge tone={t.change_request_id ? "info" : "critical"}>{t.change_request_id ? "Change request" : "● Out of scope"}</Badge>}
          {t.due_date && <Badge tone="neutral">Due {formatShort(t.due_date)}</Badge>}
        </div>
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-ink-2 sm:grid-cols-2">
        <div><dt className="inline text-ink-3">Why: </dt><dd className="inline">{t.objective || "No brief objective yet"}</dd></div>
        <div>
          <dt className="inline text-ink-3">In scope: </dt>
          <dd className="inline">{t.scope_name ? `${t.scope_name} (${t.scope_quantity} ${t.scope_unit === "hours" ? "h" : "×"}${t.rounds_allowed ? `, ${t.rounds_allowed} rounds` : ""})` : t.out_of_scope ? "No — needs a change request or absorb decision" : "Not linked to a scope item"}</dd>
        </div>
        {t.status === "blocked" && <div className="text-critical-ink sm:col-span-2">Blocked: {t.blocked_reason || "no reason given"}</div>}
      </dl>
      {t.estimate_hours > 0 && <div className="mt-3"><Meter value={t.logged_hours} max={t.estimate_hours} compact label="Time against estimate" sublabel={`${t.logged_hours}h / ${t.estimate_hours}h`} /></div>}
      <div className="mt-3 flex flex-wrap gap-2">
        {!running && (
          <form action={startTimerAction}>
            <input type="hidden" name="job_id" value={t.job_id} />
            <input type="hidden" name="task_id" value={t.id} />
            <input type="hidden" name="back" value="/app/my-day" />
            <button className={buttonClass("primary", "sm")}>▶ Start</button>
          </form>
        )}
        {running && <Badge tone="critical">● Timer running</Badge>}
        <form action={setTaskStatusAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="task_id" value={t.id} />
          <input type="hidden" name="back" value="/app/my-day" />
          <button name="status" value="done" className={buttonClass("secondary", "sm")}>Done</button>
          {t.status !== "blocked" ? (
            <>
              <input name="blocked_reason" placeholder="Blocked by…" className="!w-40 !py-1 text-xs" />
              <button name="status" value="blocked" className={buttonClass("ghost", "sm")}>Block</button>
            </>
          ) : (
            <button name="status" value="in_progress" className={buttonClass("ghost", "sm")}>Unblock</button>
          )}
          {t.status !== "waiting_client" && <button name="status" value="waiting_client" className={buttonClass("ghost", "sm")}>Waiting on client</button>}
        </form>
      </div>
    </li>
  );
}

function Section({ title, tasks, running, empty }: { title: string; tasks: MyDayTask[]; running: string | null; empty?: string }) {
  if (!tasks.length && !empty) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-ink-2">{title} <span className="text-ink-3">· {tasks.length}</span></h2>
      {tasks.length ? <ul className="space-y-3">{tasks.map((t) => <TaskCard key={t.id} t={t} running={running === t.id} />)}</ul> : <Empty>{empty}</Empty>}
    </section>
  );
}

export default async function MyDayPage() {
  const user = await requireUser();
  const { d, timer } = await tenant(user, async (tx) => ({ d: await myDay(tx, user.id), timer: await currentTimer(tx, user.id) }));
  const running = timer?.task_id ?? null;
  return (
    <>
      <PageHeader title="My Day" subtitle={`${formatShort(d.today)} · everything assigned to you, across every client`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div>
          <Section title="Overdue" tasks={d.overdue} running={running} />
          <Section title="Due today" tasks={d.dueToday} running={running} empty="Nothing due today." />
          <Section title="Blocked" tasks={d.blocked} running={running} />
          <Section title="Waiting on others" tasks={d.waiting} running={running} />
          <Section title="Up next" tasks={d.later} running={running} />
        </div>
        <aside className="space-y-4">
          <Card title="Today">
            <Meter value={d.loggedToday} max={d.dayHours} label="Time logged" sublabel={`${d.loggedToday}h of ${d.dayHours}h`} warnAt={2} />
            <Link href="/app/time" className="mt-3 block text-sm text-brand hover:underline">Confirm today's timesheet →</Link>
          </Card>
          <Card title="Workload">
            <Meter value={d.openEstimate} max={d.dayHours * 5} label="Estimated work queued" sublabel={`${Math.round(d.openEstimate)}h vs ${d.dayHours * 5}h week`} />
            <p className="mt-2 text-xs text-ink-3">{d.load > 1 ? "More than a week of work is queued. Talk to your PM about priorities." : "Within a week's capacity."}</p>
          </Card>
          <Card title="Feedback to action">
            {d.feedback.length ? (
              <ul className="space-y-1.5 text-sm">
                {d.feedback.map((f) => <li key={f.id}><Link className="hover:underline" href={`/app/deliverables/${f.id}`}>{f.company_name}: {f.name}</Link></li>)}
              </ul>
            ) : <p className="text-sm text-ink-3">No open client feedback.</p>}
          </Card>
          {d.reviews.length > 0 && (
            <Card title="Reviews requested of you">
              <ul className="space-y-1.5 text-sm">
                {d.reviews.map((f) => <li key={f.id}><Link className="hover:underline" href={`/app/deliverables/${f.id}`}>{f.job_number}: {f.name}</Link></li>)}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

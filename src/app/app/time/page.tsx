import { CaretLeft, CaretRight, LockSimple } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { confirmSuggestionsAction, deleteTimeAction, logTimeAction } from "../_actions/time";
import { Badge, Card, Empty, Field, Meter, PageHeader, Table, Td, buttonClass } from "@/components/ui";
import { requireUser, tenant } from "@/lib/auth";
import { addDays, formatShort, startOfWeek, todayIn, workingDays } from "@/lib/domain/dates";
import { can } from "@/lib/permissions";
import { TIME_CATEGORIES, timesheetCompliance, timesheetSuggestions, weekEntries } from "@/lib/services/time";

export const metadata = { title: "Time" };

export default async function TimePage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const user = await requireUser();
  const today = todayIn(user.timezone);
  const sp = await searchParams;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? sp.day! : today;
  const week = startOfWeek(day);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const data = await tenant(user, async (tx) => ({
    entries: await weekEntries(tx, user.id, week, addDays(week, 6)),
    suggestions: await timesheetSuggestions(tx, user.id, day),
    me: (await tx.one<{ weekly_hours: number; target_utilisation: number }>("select weekly_hours, target_utilisation from users where id = $1", [user.id]))!,
    options: await tx.q<{ job_id: string; task_id: string | null; label: string }>(
      `select j.id as job_id, null::uuid as task_id, j.number || ' · ' || j.name as label, 0 as o, j.number as n from jobs j where j.status <> 'closed'
          and (exists (select 1 from tasks t where t.job_id = j.id and t.assignee_id = $1) or j.owner_id = $1 or j.billing_model = 'internal' or $2)
       union all
       select t.job_id, t.id, j.number || ' · ' || case when t.out_of_scope then '⚑ ' else '' end || t.title, 1, j.number from tasks t join jobs j on j.id = t.job_id
        where t.assignee_id = $1 and t.status <> 'done' and j.status <> 'closed'
       order by 5, 4, 3`,
      [user.id, can(user, "seeAllJobs")],
    ),
    compliance: can(user, "manageTeam") ? await timesheetCompliance(tx, week, addDays(week, 4) < today ? addDays(week, 4) : today) : [],
  }));
  const weekTotal = data.entries.reduce((s, e) => s + e.hours, 0);
  const billable = data.entries.filter((e) => e.category === "billable").reduce((s, e) => s + e.hours, 0);
  const dayEntries = data.entries.filter((e) => e.work_date === day);
  const elapsedWorkdays = workingDays(week, addDays(week, 6) < today ? addDays(week, 6) : today);
  return (
    <>
      <PageHeader title="Time" subtitle="Confirm your day in a couple of minutes. Suggestions come only from your own activity in 8gency and are visible only to you until you confirm them." />
      <div className="mb-4 flex items-center gap-2">
        <Link className={buttonClass("ghost", "sm")} href={`/app/time?day=${addDays(week, -7)}`}><CaretLeft aria-hidden size={14} /> Prev week</Link>
        <Link className={buttonClass("ghost", "sm")} href="/app/time">This week</Link>
        <Link className={buttonClass("ghost", "sm")} href={`/app/time?day=${addDays(week, 7)}`}>Next week <CaretRight aria-hidden size={14} /></Link>
      </div>
      <div className="mb-5 grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const h = data.entries.filter((e) => e.work_date === d).reduce((s, e) => s + e.hours, 0);
          return (
            <Link key={d} href={`/app/time?day=${d}`} className={`rounded-lg border p-2 text-center ${d === day ? "border-brand bg-brand/10" : "border-line bg-surface hover:bg-surface-2"}`}>
              <div className="text-xs text-ink-3">{new Date(`${d}T00:00:00Z`).toLocaleDateString("en-ZA", { weekday: "short", timeZone: "UTC" })} {d.slice(8)}</div>
              <div className="tnum font-semibold">{h ? `${h}h` : "—"}</div>
            </Link>
          );
        })}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card title={`Suggested for ${formatShort(day)}`}>
            {data.suggestions.length ? (
              <form action={confirmSuggestionsAction} className="space-y-2">
                <input type="hidden" name="work_date" value={day} />
                <input type="hidden" name="back" value={`/app/time?day=${day}`} />
                {data.suggestions.map((s) => {
                  const key = `${s.job_id}:${s.task_id ?? ""}`;
                  return (
                    <div key={key} className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{s.job_number} · {s.task_title ?? s.job_name}</div>
                        <div className="text-xs text-ink-3">Because you {s.reason}{s.out_of_scope && !s.has_change_request ? " · out of scope: a change request will be drafted" : ""}</div>
                      </div>
                      <input name={`hours:${key}`} defaultValue={s.hours} className="field-sm !w-20 text-right" inputMode="decimal" aria-label="Hours" />
                      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name={`skip:${key}`} /> skip</label>
                    </div>
                  );
                })}
                <SubmitButton className={buttonClass("primary", "sm")}>Confirm {formatShort(day)}</SubmitButton>
              </form>
            ) : <p className="text-sm text-ink-3">No suggestions: either your day is logged, or there's no 8gency activity to build from yet. Starting a timer from My Day captures time as you go.</p>}
          </Card>
          <Card title={`Logged on ${formatShort(day)}`} pad={false}>
            <Table head={["Job", "Task / notes", "Category", "Hours", ""]} empty="Nothing logged this day.">
              {dayEntries.map((e) => (
                <tr key={e.id}>
                  <Td><Link className="hover:underline" href={`/app/jobs/${e.job_id}?tab=time`}>{e.job_number}</Link></Td>
                  <Td className="max-w-[18rem] truncate text-ink-2">{e.task_title ?? e.notes ?? e.job_name} {e.out_of_scope && <Badge tone={e.oos_resolution === "absorbed" ? "warning" : "info"}>{e.oos_resolution === "absorbed" ? "absorbed" : "CR"}</Badge>} {e.source !== "manual" && <span className="text-xs text-ink-3">· {e.source}</span>}</Td>
                  <Td className="text-xs text-ink-2">{e.category.replace(/_/g, " ")}</Td>
                  <Td right>{e.hours}</Td>
                  <Td>{e.locked || (e.invoice_line_id && e.invoice_status !== "draft") ? <span title="Locked: closed month or issued invoice" className="inline-flex text-ink-3"><LockSimple aria-hidden size={14} /><span className="sr-only">Locked</span></span> : (
                    <form action={deleteTimeAction}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="back" value={`/app/time?day=${day}`} /><SubmitButton confirm={e.invoice_status === "draft" ? "Remove this time entry? It also comes off the client's next invoice." : "Remove this time entry?"} className={buttonClass("ghost", "sm")}>Remove</SubmitButton></form>
                  )}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
        <aside className="space-y-4">
          <Card title="Log time">
            <form action={logTimeAction} className="space-y-3">
              <input type="hidden" name="back" value={`/app/time?day=${day}`} />
              <Field label="Job or task">
                <select name="job_task" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {data.options.map((o) => <option key={`${o.job_id}:${o.task_id ?? ""}`} value={`${o.job_id}:${o.task_id ?? ""}`}>{o.task_id ? "   " : ""}{o.label}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Date"><input type="date" name="work_date" defaultValue={day} /></Field>
                <Field label="Hours"><input name="hours" inputMode="decimal" required placeholder="1.5" /></Field>
              </div>
              <Field label="Category"><select name="category" defaultValue="">{[{ key: "", label: "Default for job" }, ...TIME_CATEGORIES].map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></Field>
              <Field label="Notes"><input name="notes" /></Field>
              <Field label="Out-of-scope tasks" hint="Required by Scope Guard."><select name="oos_resolution" defaultValue="change_request"><option value="change_request">Draft a change request</option><option value="absorbed">Absorb (give a reason)</option></select></Field>
              <Field label="Absorb reason" hint="Only if absorbing."><input name="absorb_reason" /></Field>
              <SubmitButton className={buttonClass("primary", "sm")}>Log</SubmitButton>
            </form>
          </Card>
          <Card title="This week">
            <Meter value={weekTotal} max={data.me.weekly_hours} label="Logged" sublabel={`${weekTotal}h / ${data.me.weekly_hours}h`} warnAt={1.5} />
            <div className="mt-3"><Meter value={billable} max={(data.me.weekly_hours / 5) * Math.max(1, elapsedWorkdays) * data.me.target_utilisation} label="Billable vs your target so far" sublabel={`${billable}h`} warnAt={1.5} /></div>
            <p className="mt-2 text-xs text-ink-3">Your target is {Math.round(data.me.target_utilisation * 100)}% billable, set for your role.</p>
          </Card>
          {data.compliance.length > 0 && (
            <Card title="Team: days logged this week">
              <ul className="space-y-1 text-sm">
                {data.compliance.map((c) => (
                  <li key={c.user_id} className="flex justify-between"><span>{c.name}</span><span className={`tnum ${c.days_logged < elapsedWorkdays - 1 ? "text-warning-ink" : ""}`}>{c.days_logged}/{Math.min(5, elapsedWorkdays)} days · {c.hours}h</span></li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-3">Managers see totals only — never the activity behind suggestions.</p>
            </Card>
          )}
          {!data.compliance.length && <Empty>Time is locked after month-end close.</Empty>}
        </aside>
      </div>
    </>
  );
}

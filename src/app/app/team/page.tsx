import { Info } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Avatar, Badge, Card, Empty, PageHeader, Tabs, TextLink, buttonClass, cx, type Tone } from "@/components/ui";
import { requireCap, requireUser, tenant } from "@/lib/auth";
import { addDays, addMonths, endOfMonth, formatShort, startOfMonth, startOfWeek, todayIn } from "@/lib/domain/dates";
import type { WorkloadStatus } from "@/lib/domain/workload";
import { teamTimesheet, teamWorkload, type PersonWorkload, type TimesheetRow } from "@/lib/services/team";

export const metadata = { title: "Team" };

const STATUS: Record<WorkloadStatus, { label: string; tone: Tone }> = {
  overloaded: { label: "Overloaded", tone: "critical" },
  stretched: { label: "Stretched", tone: "warning" },
  balanced: { label: "Balanced", tone: "good" },
  light: { label: "Light", tone: "neutral" },
};

const PERIODS = [
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
] as const;

function range(period: string, today: string) {
  const wk = startOfWeek(today);
  if (period === "last_week") return { from: addDays(wk, -7), to: addDays(wk, -1) };
  if (period === "this_month") return { from: startOfMonth(today), to: today };
  if (period === "last_month") {
    const m = addMonths(startOfMonth(today), -1);
    return { from: m, to: endOfMonth(m) };
  }
  return { from: wk, to: today };
}

const h = (n: number) => `${Math.round(n * 10) / 10}h`;

/** Six weekly bars (last five weeks + this one) against a contracted-hours line. */
function WeekBars({ p }: { p: PersonWorkload }) {
  const top = Math.max(p.weeklyHours * 1.5, ...p.weeks.map((w) => w.hours));
  return (
    <div role="img" aria-label={`Last 6 weeks: ${p.weeks.map((w) => h(w.hours)).join(", ")} (${h(p.weeklyHours)} contracted)`} className="relative flex h-10 items-end gap-1">
      <span aria-hidden className="absolute inset-x-0 border-t border-dashed border-ink-3/60" style={{ bottom: `${(p.weeklyHours / top) * 100}%` }} />
      {p.weeks.map((w, i) => {
        const r = w.hours / p.weeklyHours;
        return (
          <span
            key={w.start}
            title={`Week of ${formatShort(w.start)}: ${h(w.hours)}`}
            className={cx("w-3 rounded-sm", r > 1.25 ? "bg-critical" : r > 1.1 ? "bg-warning" : "bg-seq", i === p.weeks.length - 1 && "opacity-60")}
            style={{ height: `${Math.max(4, (w.hours / top) * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

function HowCalculated({ children }: { children: React.ReactNode }) {
  return (
    <details className="mt-4 text-sm">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded text-ink-3 hover:text-ink pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <Info aria-hidden size={14} /> How this is worked out
      </summary>
      <div className="mt-2 max-w-3xl space-y-1 text-xs leading-relaxed text-ink-3">{children}</div>
    </details>
  );
}

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ tab?: string; period?: string; person?: string; client?: string; group?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  requireCap(user, "seeTeamTime");
  const tab = sp.tab === "timesheets" ? "timesheets" : "workload";
  const today = todayIn(user.timezone);
  const period = PERIODS.some((p) => p.key === sp.period) ? sp.period! : "this_week";
  const { from, to } = range(period, today);
  const person = /^[0-9a-f-]{36}$/i.test(sp.person ?? "") ? sp.person! : null;
  const client = /^[0-9a-f-]{36}$/i.test(sp.client ?? "") ? sp.client! : null;
  const group = sp.group === "client" ? "client" : "person";

  const data = await tenant(user, async (tx) => ({
    workload: tab === "workload" ? await teamWorkload(tx, today) : [],
    rows: tab === "timesheets" ? await teamTimesheet(tx, { from, to, userId: person, companyId: client }) : [],
    people: await tx.q<{ id: string; name: string }>("select id, name from users where active order by name"),
    clients: tab === "timesheets" ? await tx.q<{ id: string; name: string }>("select id, name from companies where kind = 'client' order by name") : [],
  }));

  const counts = Object.fromEntries((Object.keys(STATUS) as WorkloadStatus[]).map((s) => [s, data.workload.filter((p) => p.status === s).length])) as Record<WorkloadStatus, number>;
  const total = data.rows.reduce((s, r) => s + r.hours, 0);
  const billable = data.rows.reduce((s, r) => s + r.billable, 0);

  return (
    <>
      <PageHeader title="Team" subtitle="What everyone is working on for each client and job, and who has too much on." />
      <Tabs base="/app/team" active={tab} tabs={[{ key: "workload", label: "Workload" }, { key: "timesheets", label: "Timesheets" }]} />

      {tab === "workload" && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {(Object.keys(STATUS) as WorkloadStatus[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm shadow-xs">
                <Badge tone={STATUS[s].tone} dot>{STATUS[s].label}</Badge>
                <b className="tnum font-semibold">{counts[s]}</b>
              </span>
            ))}
          </div>
          <Card pad={false}>
            {data.workload.length ? (
              <ul className="divide-y divide-line">
                {data.workload.map((p) => (
                  <li key={p.id} id={`p-${p.id}`} className={cx("grid scroll-mt-24 gap-x-6 gap-y-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-center", person === p.id && "bg-brand/5")}>
                    <div className="flex min-w-0 items-start gap-3">
                      <Avatar name={p.name} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{p.name}</span>
                          <Badge tone={STATUS[p.status].tone} dot>{STATUS[p.status].label}</Badge>
                        </div>
                        <div className="text-xs text-ink-3">{p.title}</div>
                        {p.reasons.length > 0 && <ul className="mt-1.5 space-y-0.5 text-sm text-ink-2">{p.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
                      </div>
                    </div>
                    <div className="max-lg:pl-11">
                      <div className="mb-1 text-xs text-ink-3">Last 6 weeks</div>
                      <WeekBars p={p} />
                    </div>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-sm max-lg:pl-11 lg:block lg:space-y-1 lg:text-right">
                      <dt className="text-xs text-ink-3">This week</dt>
                      <dd className="tnum font-medium">{h(p.thisWeek)} <span className="font-normal text-ink-3">/ {h(p.weeklyHours)}</span></dd>
                      <dt className="text-xs text-ink-3">Booked, next 2 weeks</dt>
                      <dd className={cx("tnum font-medium", (p.bookedLoad ?? 0) > 1 && "text-warning-ink")}>{Math.round((p.bookedLoad ?? 0) * 100)}%</dd>
                    </dl>
                    <div className="max-lg:pl-11">
                      <TextLink href={`/app/team?tab=timesheets&person=${p.id}&period=this_week`}>Timesheet</TextLink>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4"><Empty>Add contracted hours to people in Settings › Team to see their workload.</Empty></div>
            )}
          </Card>
          <HowCalculated>
            <p><b>Overloaded</b>: two of the last four weeks more than 10% over contracted hours, a 4-week average above 115%, a very heavy week so far, or more than 125% of their next two weeks already booked with open tasks.</p>
            <p><b>Stretched</b>: one long week, a 4-week average above contract, more work booked than time, 4h or more of weekend work in four weeks, or 3+ overdue tasks.</p>
            <p><b>Light</b>: logging and booked well under half their hours: room to take more on (or time isn&apos;t being logged).</p>
            <p>Owners and ops get a &quot;Watch …&apos;s workload&quot; notification once a week for anyone overloaded (Automations › Burnout watch).</p>
          </HowCalculated>
        </>
      )}

      {tab === "timesheets" && (
        <>
          <form className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm">
            <input type="hidden" name="tab" value="timesheets" />
            <label className="block w-full space-y-1 sm:w-40">
              <span className="text-[13px] font-medium text-ink-2">Period</span>
              <select name="period" defaultValue={period}>{PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
            </label>
            <label className="block w-full space-y-1 sm:w-48">
              <span className="text-[13px] font-medium text-ink-2">Person</span>
              <select name="person" defaultValue={person ?? ""}><option value="">Everyone</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </label>
            <label className="block w-full space-y-1 sm:w-48">
              <span className="text-[13px] font-medium text-ink-2">Client</span>
              <select name="client" defaultValue={client ?? ""}><option value="">All clients</option>{data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </label>
            <label className="block w-full space-y-1 sm:w-40">
              <span className="text-[13px] font-medium text-ink-2">Group by</span>
              <select name="group" defaultValue={group}><option value="person">Person</option><option value="client">Client</option></select>
            </label>
            <button className={buttonClass("primary")}>Show</button>
          </form>

          <p className="mb-4 text-sm text-ink-2">
            {formatShort(from)} – {formatShort(to)}: <b className="tnum font-semibold text-ink">{h(total)}</b> logged
            {total > 0 && <>, {Math.round((billable / total) * 100)}% billable</>} · {new Set(data.rows.map((r) => r.user_id)).size} people · {new Set(data.rows.map((r) => r.company_id)).size} clients
          </p>

          {data.rows.length === 0 ? (
            <Empty>No time logged for this selection.</Empty>
          ) : group === "person" ? (
            <ByPerson rows={data.rows} />
          ) : (
            <ByClient rows={data.rows} />
          )}
        </>
      )}
    </>
  );
}

function groupBy<T>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.values()];
}

/** One card per person: client · job → task → what they did, with hours. */
function ByPerson({ rows }: { rows: TimesheetRow[] }) {
  return (
    <div className="space-y-4">
      {groupBy(rows, (r) => r.user_id).map((g) => {
        const hours = g.reduce((s, r) => s + r.hours, 0);
        const bill = g.reduce((s, r) => s + r.billable, 0);
        return (
          <Card
            key={g[0].user_id}
            pad={false}
            title={
              <span className="flex items-center gap-2.5">
                <Avatar name={g[0].user_name} size="sm" />
                {g[0].user_name} <span className="font-normal text-ink-3">{g[0].user_title}</span>
              </span>
            }
            actions={<span className="text-sm text-ink-2"><b className="tnum font-semibold text-ink">{h(hours)}</b> · {hours ? Math.round((bill / hours) * 100) : 0}% billable</span>}
          >
            <TimeTable rows={g} first="client" />
          </Card>
        );
      })}
    </div>
  );
}

/** One card per client: job → task → who worked on it, with hours. */
function ByClient({ rows }: { rows: TimesheetRow[] }) {
  return (
    <div className="space-y-4">
      {groupBy(rows, (r) => r.company_id).map((g) => {
        const hours = g.reduce((s, r) => s + r.hours, 0);
        return (
          <Card key={g[0].company_id} pad={false} title={<Link href={`/app/clients/${g[0].company_id}`} className="hover:underline">{g[0].company_name}</Link>} actions={<b className="tnum text-sm font-semibold">{h(hours)}</b>}>
            <TimeTable rows={[...g].sort((a, b) => a.job_number.localeCompare(b.job_number) || (a.task_title ?? "").localeCompare(b.task_title ?? ""))} first="person" />
          </Card>
        );
      })}
    </div>
  );
}

function TimeTable({ rows, first }: { rows: TimesheetRow[]; first: "client" | "person" }) {
  return (
    <div className="relative overflow-x-auto" tabIndex={0}>
      <table className="w-full min-w-[640px] table-fixed text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2/60 text-left text-xs font-medium text-ink-3">
            <th className="w-[34%] px-4 py-2.5 font-medium">Job</th>
            <th className="w-[22%] px-3 py-2.5 font-medium">Task</th>
            <th className="px-3 py-2.5 font-medium">{first === "client" ? "What they did" : "Who, and what they did"}</th>
            <th className="w-24 px-4 py-2.5 text-right font-medium">Hours</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => {
            const newJob = i === 0 || rows[i - 1].job_id !== r.job_id;
            return (
              <tr key={`${r.user_id}:${r.job_id}:${r.task_id}`} className="align-top">
                <td className="px-4 py-2.5">
                  {newJob && (
                    <Link href={`/app/jobs/${r.job_id}?tab=time`} className="hover:underline">
                      {first === "client" && <span className="block text-xs text-ink-3">{r.company_name}</span>}
                      <span className="font-medium">{r.job_number}</span> <span className="text-ink-2">{r.job_name}</span>
                    </Link>
                  )}
                </td>
                <td className="px-3 py-2.5 text-ink-2">{r.task_title ?? <span className="text-ink-3">Whole job</span>}</td>
                <td className="px-3 py-2.5 text-ink-2">
                  {first === "client" ? (
                    r.notes.length ? <span className="line-clamp-2" title={r.notes.join("; ")}>{r.notes.join("; ")}</span> : <span className="text-ink-3">No notes</span>
                  ) : (
                    <>
                      <span className="flex items-center gap-2 text-ink"><Avatar name={r.user_name} size="sm" />{r.user_name}</span>
                      {r.notes.length > 0 && <span className="mt-1 line-clamp-2 text-xs" title={r.notes.join("; ")}>{r.notes.join("; ")}</span>}
                    </>
                  )}
                </td>
                <td className="tnum whitespace-nowrap px-4 py-2.5 text-right">
                  <span className="font-medium">{h(r.hours)}</span>
                  {r.billable < r.hours && <span className="block text-xs text-ink-3">{h(r.billable)} billable</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

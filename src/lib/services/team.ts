import type { Tx } from "../db";
import { addDays, startOfWeek, workingDays } from "../domain/dates";
import { assessWorkload, WORKLOAD_RANK, type WorkloadResult } from "../domain/workload";

export interface TimesheetRow {
  user_id: string;
  user_name: string;
  user_title: string;
  company_id: string;
  company_name: string;
  job_id: string;
  job_number: string;
  job_name: string;
  task_id: string | null;
  task_title: string | null;
  hours: number;
  billable: number;
  notes: string[];
  entries: number;
  first_date: string;
  last_date: string;
}

/**
 * Everyone's time for a period, one row per person × job × task, with what
 * they wrote about it. Ops and managers use it to see what each person
 * worked on for each client and job.
 */
export function teamTimesheet(tx: Tx, f: { from: string; to: string; userId?: string | null; companyId?: string | null }) {
  return tx.q<TimesheetRow>(
    `select te.user_id, u.name as user_name, u.title as user_title, j.company_id, co.name as company_name,
            te.job_id, j.number as job_number, j.name as job_name, te.task_id, t.title as task_title,
            round(sum(te.hours), 2)::float as hours,
            coalesce(round(sum(te.hours) filter (where te.category = 'billable'), 2), 0)::float as billable,
            array_remove(array_agg(distinct nullif(btrim(regexp_replace(te.notes, '^\\[closed-job override:[^]]*\\]\\s*', '')), '')), null) as notes,
            count(*)::int as entries, min(te.work_date)::text as first_date, max(te.work_date)::text as last_date
       from time_entries te
       join users u on u.id = te.user_id
       join jobs j on j.id = te.job_id
       join companies co on co.id = j.company_id
       left join tasks t on t.id = te.task_id
      where te.work_date between $1 and $2
        and ($3::uuid is null or te.user_id = $3)
        and ($4::uuid is null or j.company_id = $4)
      group by te.user_id, u.name, u.title, j.company_id, co.name, te.job_id, j.number, j.name, te.task_id, t.title
      order by u.name, co.name, j.number, t.title nulls first`,
    [f.from, f.to, f.userId ?? null, f.companyId ?? null],
  );
}

export interface PersonWorkload extends WorkloadResult {
  id: string;
  name: string;
  title: string;
  weeklyHours: number;
  /** Last 5 complete weeks then this week, oldest first. */
  weeks: { start: string; hours: number }[];
  thisWeek: number;
  bookedNext14: number;
  overdueTasks: number;
  weekendHours: number;
}

/** Every active person's recent load, most at-risk first. */
export async function teamWorkload(tx: Tx, today: string): Promise<PersonWorkload[]> {
  const week0 = startOfWeek(today);
  const starts = Array.from({ length: 6 }, (_, i) => addDays(week0, (i - 5) * 7));
  const people = await tx.q<{ id: string; name: string; title: string; weekly_hours: number }>(
    "select id, name, title, weekly_hours::float as weekly_hours from users where active and weekly_hours > 0 order by name",
  );
  const weekly = await tx.q<{ user_id: string; week: string; hours: number }>(
    `select user_id, date_trunc('week', work_date)::date::text as week, sum(hours)::float as hours
       from time_entries where work_date >= $1 and work_date <= $2 group by 1, 2`,
    [starts[0], today],
  );
  const weekend = await tx.q<{ user_id: string; hours: number }>(
    "select user_id, sum(hours)::float as hours from time_entries where work_date > $1 and work_date <= $2 and extract(isodow from work_date) > 5 group by 1",
    [addDays(today, -28), today],
  );
  const booked = await tx.q<{ user_id: string; hours: number; overdue: number }>(
    `select t.assignee_id as user_id,
            coalesce(sum(greatest(t.estimate_hours - coalesce(l.h, 0), 0)) filter (where t.due_date between $1 and $2), 0)::float as hours,
            count(*) filter (where t.due_date < $1)::int as overdue
       from tasks t join jobs j on j.id = t.job_id
       left join (select task_id, sum(hours) as h from time_entries group by task_id) l on l.task_id = t.id
      where t.assignee_id is not null and t.status <> 'done' and j.status <> 'closed'
      group by 1`,
    [today, addDays(today, 14)],
  );
  const hoursFor = (uid: string, start: string) => weekly.find((r) => r.user_id === uid && r.week === start)?.hours ?? 0;
  const workdays = workingDays(week0, today);
  return people
    .map((p) => {
      const weeks = starts.map((start) => ({ start, hours: hoursFor(p.id, start) }));
      const b = booked.find((r) => r.user_id === p.id);
      const input = {
        weeklyHours: p.weekly_hours,
        pastWeeks: weeks.slice(0, 5).map((w) => w.hours),
        thisWeek: weeks[5].hours,
        thisWeekWorkdays: workdays,
        weekendHours: weekend.find((r) => r.user_id === p.id)?.hours ?? 0,
        bookedNext14: b?.hours ?? 0,
        overdueTasks: b?.overdue ?? 0,
      };
      return { id: p.id, name: p.name, title: p.title, weeklyHours: p.weekly_hours, weeks, thisWeek: input.thisWeek, bookedNext14: input.bookedNext14, overdueTasks: input.overdueTasks, weekendHours: input.weekendHours, ...assessWorkload(input) };
    })
    .sort((a, b) => WORKLOAD_RANK[a.status] - WORKLOAD_RANK[b.status] || (b.recentLoad ?? 0) - (a.recentLoad ?? 0));
}

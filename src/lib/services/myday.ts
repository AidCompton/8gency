import type { Tx } from "../db";
import { todayIn } from "../domain/dates";
import { agencySettings } from "./core";

export interface MyDayTask {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  estimate_hours: number;
  blocked_reason: string | null;
  out_of_scope: boolean;
  change_request_id: string | null;
  job_id: string;
  job_number: string;
  job_name: string;
  company_name: string;
  scope_name: string | null;
  scope_unit: string | null;
  scope_quantity: number | null;
  rounds_allowed: number | null;
  logged_hours: number;
  objective: string | null;
}

/** One personal queue across every client (M09). */
export async function myDay(tx: Tx, userId: string) {
  const settings = await agencySettings(tx);
  const today = todayIn(settings.timezone);
  const tasks = await tx.q<MyDayTask>(
    `select t.id, t.title, t.status, t.due_date, t.estimate_hours, t.blocked_reason, t.out_of_scope, t.change_request_id,
            j.id as job_id, j.number as job_number, j.name as job_name, c.name as company_name,
            s.name as scope_name, s.unit as scope_unit, s.quantity as scope_quantity, s.rounds_allowed,
            coalesce((select sum(hours) from time_entries te where te.task_id = t.id),0) as logged_hours,
            b.objective
       from tasks t join jobs j on j.id = t.job_id join companies c on c.id = j.company_id
       left join scope_items s on s.id = t.scope_item_id
       left join briefs b on b.job_id = j.id
      where t.assignee_id = $1 and t.status <> 'done' and j.status <> 'closed'
      order by t.due_date nulls last, t.created_at`,
    [userId],
  );
  const feedback = await tx.q<{ id: string; name: string; job_number: string; company_name: string }>(
    `select distinct d.id, d.name, j.number as job_number, c.name as company_name
       from deliverables d join jobs j on j.id = d.job_id join companies c on c.id = j.company_id
      where d.status = 'changes_requested'
        and (j.owner_id = $1 or exists (select 1 from tasks t where t.job_id = j.id and t.assignee_id = $1))`,
    [userId],
  );
  const reviews = await tx.q<{ id: string; name: string; job_number: string; company_name: string }>(
    `select d.id, d.name, j.number as job_number, c.name as company_name
       from deliverables d join jobs j on j.id = d.job_id join companies c on c.id = j.company_id
      where d.status = 'internal_review'
        and exists (select 1 from users u where u.id = $1 and (u.role = 'owner' or u.title ilike '%creative director%'))`,
    [userId],
  );
  const loggedToday = (await tx.one<{ h: number }>("select coalesce(sum(hours),0) as h from time_entries where user_id = $1 and work_date = $2", [userId, today]))!.h;
  const user = await tx.one<{ weekly_hours: number }>("select weekly_hours from users where id = $1", [userId]);
  const dueToday = tasks.filter((t) => t.due_date === today);
  const overdue = tasks.filter((t) => t.due_date && t.due_date < today);
  const blocked = tasks.filter((t) => t.status === "blocked");
  const waiting = tasks.filter((t) => t.status === "waiting_client");
  const later = tasks.filter((t) => !dueToday.includes(t) && !overdue.includes(t) && !blocked.includes(t) && !waiting.includes(t));
  const openEstimate = tasks.reduce((s, t) => s + Math.max(0, t.estimate_hours - t.logged_hours), 0);
  const weekCapacity = user?.weekly_hours ?? 40;
  return {
    today,
    dueToday,
    overdue,
    blocked,
    waiting,
    later,
    feedback,
    reviews,
    loggedToday,
    dayHours: weekCapacity / 5,
    load: openEstimate / weekCapacity, // >1 means more than a week of estimated work queued
    openEstimate,
  };
}

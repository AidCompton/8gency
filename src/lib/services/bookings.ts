import type { Tx } from "../db";
import { BOOKABLE_TEAMS, bookingProblems, endTime } from "../domain/bookings";
import { formatShort, todayIn } from "../domain/dates";
import { agencySettings, notify, UserError } from "./core";

// Booking design and web time on a job. A booking holds the person's time,
// draws on the job's hour budget and an agreed scope item, and lands on their
// My Day as a task; time they log on that task uses the booking up.

export interface BookablePerson {
  id: string;
  name: string;
  title: string;
  team: string;
  day_capacity: number;
}

export interface BookingRow {
  id: string;
  user_id: string;
  user_name: string;
  job_id: string;
  job_label: string;
  company_name: string;
  scope_name: string;
  work_date: string;
  start_time: string;
  hours: number;
  title: string;
  notes: string;
  booked_by: string | null;
  booked_by_name: string | null;
  status: string;
}

/** Hours a live booking still holds: its hours less time already logged on its task, until the task is done. */
const AHEAD = `case when b.status = 'booked' and coalesce(t.status, 'todo') <> 'done'
                    then greatest(b.hours - coalesce((select sum(te.hours) from time_entries te where te.task_id = b.task_id), 0), 0) else 0 end`;

export const bookablePeople = (tx: Tx) =>
  tx.q<BookablePerson>("select id, name, title, team, (weekly_hours / 5)::float as day_capacity from users where active and team = any($1) order by team, name", [BOOKABLE_TEAMS]);

export function bookingsBetween(tx: Tx, from: string, to: string, filter: { userId?: string; bookedBy?: string } = {}) {
  return tx.q<BookingRow>(
    `select b.id, b.user_id, u.name as user_name, b.job_id, j.number || ' ' || j.name as job_label, co.name as company_name, s.name as scope_name,
            b.work_date::text, to_char(b.start_time, 'HH24:MI') as start_time, b.hours::float, b.title, b.notes, b.booked_by, bb.name as booked_by_name, b.status
       from bookings b join users u on u.id = b.user_id join jobs j on j.id = b.job_id join companies co on co.id = j.company_id
       join scope_items s on s.id = b.scope_item_id left join users bb on bb.id = b.booked_by
      where b.status = 'booked' and b.work_date between $1 and $2
        and ($3::uuid is null or b.user_id = $3) and ($4::uuid is null or b.booked_by = $4)
      order by b.work_date, b.start_time`,
    [from, to, filter.userId ?? null, filter.bookedBy ?? null],
  );
}

export interface BookableJob {
  id: string;
  label: string;
  budget: number;
  logged: number;
  ahead: number;
  scope: { id: string; name: string; unit: string; quantity: number; logged: number; ahead: number }[];
}

/** Live jobs with their hour budget and scope items, and how much of each is used or already booked. */
export async function bookableJobs(tx: Tx, jobId?: string): Promise<BookableJob[]> {
  const jobs = await tx.q<Omit<BookableJob, "scope"> & { retainer_id: string | null }>(
    `select j.id, co.name || ' · ' || j.number || ' ' || j.name as label, j.retainer_id, j.budget_hours::float as budget,
            coalesce((select sum(hours) from time_entries te where te.job_id = j.id), 0)::float as logged,
            coalesce((select sum(${AHEAD}) from bookings b left join tasks t on t.id = b.task_id where b.job_id = j.id), 0)::float as ahead
       from jobs j join companies co on co.id = j.company_id
      where j.status in ('briefing','in_progress','waiting_client') and ($1::uuid is null or j.id = $1)
      order by co.name, j.number`,
    [jobId ?? null],
  );
  const scope = await tx.q<BookableJob["scope"][number] & { job_id: string | null; retainer_id: string | null }>(
    `select s.id, s.name, s.unit, s.quantity::float, s.job_id, s.retainer_id,
            coalesce((select sum(hours) from time_entries te where te.scope_item_id = s.id), 0)::float as logged,
            coalesce((select sum(${AHEAD}) from bookings b left join tasks t on t.id = b.task_id where b.scope_item_id = s.id), 0)::float as ahead
       from scope_items s
      where s.job_id = any($1) or s.retainer_id = any($2)
      order by s.source, s.created_at`,
    [jobs.map((j) => j.id), jobs.map((j) => j.retainer_id).filter(Boolean)],
  );
  return jobs.map(({ retainer_id, ...j }) => ({
    ...j,
    scope: scope.filter((s) => s.job_id === j.id || (retainer_id && s.retainer_id === retainer_id)).map(({ job_id: _j, retainer_id: _r, ...s }) => s),
  }));
}

export const jobHoursLeft = (j: Pick<BookableJob, "budget" | "logged" | "ahead">) => (j.budget > 0 ? Math.max(0, j.budget - j.logged - j.ahead) : null);
export const scopeHoursLeft = (s: BookableJob["scope"][number]) => (s.unit === "hours" ? Math.max(0, s.quantity - s.logged - s.ahead) : null);

export async function createBooking(
  tx: Tx,
  input: { user_id: string; job_id: string; scope_item_id: string; work_date: string; start_time: string; hours: number; title: string; notes?: string },
) {
  const title = input.title.trim();
  if (!title) throw new UserError("Say what the work is (it becomes their task).");
  const person = (await bookablePeople(tx)).find((p) => p.id === input.user_id);
  if (!person) throw new UserError("Choose someone from the design or web team.");
  const [job] = await bookableJobs(tx, input.job_id);
  if (!job) throw new UserError("Choose a live job.");
  const scope = job.scope.find((s) => s.id === input.scope_item_id);
  if (!scope) throw new UserError("Choose what in the job's scope this work is for.");
  // Lock the person's day so two bookings made at once can't both take the last free hours.
  await tx.q("select id from users where id = $1 for update", [person.id]);
  const sameDay = await tx.q<{ start: string; hours: number; title: string }>(
    "select to_char(start_time, 'HH24:MI') as start, hours::float, title from bookings where user_id = $1 and work_date = $2 and status = 'booked'",
    [person.id, input.work_date],
  );
  const problems = bookingProblems(
    { date: input.work_date, start: input.start_time, hours: input.hours },
    { today: todayIn((await agencySettings(tx)).timezone), dayCapacity: person.day_capacity, sameDay, jobHoursLeft: jobHoursLeft(job), scopeHoursLeft: scopeHoursLeft(scope), scopeName: scope.name },
  );
  if (problems.length) throw new UserError(problems.join(" "));

  const range = `${input.start_time}–${endTime(input.start_time, input.hours)}`;
  const task = await tx.one<{ id: string }>(
    `insert into tasks (agency_id, job_id, title, assignee_id, due_date, estimate_hours, scope_item_id, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [tx.agencyId, job.id, title, person.id, input.work_date, input.hours, scope.id, `Booked by ${tx.actorLabel} for ${formatShort(input.work_date)}, ${range}.${input.notes ? `\n${input.notes}` : ""}`],
  );
  const b = await tx.one<{ id: string }>(
    `insert into bookings (agency_id, user_id, job_id, scope_item_id, task_id, booked_by, work_date, start_time, hours, title, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [tx.agencyId, person.id, job.id, scope.id, task!.id, tx.userId, input.work_date, input.start_time, input.hours, title, input.notes?.trim() ?? ""],
  );
  if (person.id !== tx.userId) {
    await notify(tx, [person.id], {
      kind: "booking",
      title: `${tx.actorLabel} booked you: ${title}`,
      body: `${formatShort(input.work_date)}, ${range} on ${job.label}`,
      href: "/app/bookings#mine",
      dedupe: `booking:${b!.id}`,
    });
  }
  await tx.audit("booking.created", "booking", b!.id, undefined, { person: person.name, job: job.label, scope: scope.name, date: input.work_date, start: input.start_time, hours: input.hours });
  return b!.id;
}

/** Free the time: the task goes too, unless someone has started logging time on it. */
async function release(tx: Tx, id: string, status: "declined" | "cancelled", reason: string | null) {
  const b = await tx.one<{ user_id: string; booked_by: string | null; task_id: string | null; title: string; work_date: string; status: string }>(
    "select user_id, booked_by, task_id, title, work_date::text, status from bookings where id = $1 for update",
    [id],
  );
  if (!b || b.status !== "booked") throw new UserError("That booking is no longer active.");
  await tx.q("update bookings set status = $2, decline_reason = $3 where id = $1", [id, status, reason]);
  const started = b.task_id && (await tx.one("select 1 from time_entries where task_id = $1 union all select 1 from timers where task_id = $1 limit 1", [b.task_id]));
  if (b.task_id && !started) {
    await tx.q("update bookings set task_id = null where id = $1", [id]);
    await tx.q("delete from tasks where id = $1", [b.task_id]);
  }
  await tx.audit(`booking.${status}`, "booking", id, { status: "booked" }, { status, reason });
  return b;
}

export async function declineBooking(tx: Tx, id: string, reason: string) {
  if (!reason.trim()) throw new UserError("Say why, so they can book someone else or another time.");
  const b = await release(tx, id, "declined", reason.trim());
  await notify(tx, [b.booked_by], { kind: "booking", title: `${tx.actorLabel} can't take “${b.title}”`, body: `${formatShort(b.work_date)}: ${reason.trim()}`, href: "/app/bookings", dedupe: `booking-declined:${id}` });
}

export async function cancelBooking(tx: Tx, id: string) {
  const b = await release(tx, id, "cancelled", null);
  if (b.user_id !== tx.userId) await notify(tx, [b.user_id], { kind: "booking", title: `Booking cancelled: ${b.title}`, body: formatShort(b.work_date), href: "/app/bookings#mine", dedupe: `booking-cancelled:${id}` });
}

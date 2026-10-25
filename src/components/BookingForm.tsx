"use client";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { bookingProblems, endTime, TEAMS } from "@/lib/domain/bookings";
import { formatShort } from "@/lib/domain/dates";
import type { BookableJob, BookablePerson } from "@/lib/services/bookings";
import { SubmitButton } from "./SubmitButton";
import { buttonClass, cx, Field } from "./ui";

type Day = { start: string; hours: number; title: string }[];

const h = (n: number) => `${Math.round(n * 100) / 100}h`;

/**
 * Book a design or web person's time. Everything a booking needs (when, how
 * long, which job, which part of its scope) on one form, with live checks
 * against their free time, the job's hours and the scope item.
 */
export function BookingForm({
  people,
  jobs,
  booked,
  today,
  week,
  initial,
  action,
}: {
  people: BookablePerson[];
  jobs: BookableJob[];
  /** Existing bookings by person, then date. */
  booked: Record<string, Record<string, Day>>;
  today: string;
  week: string;
  initial: { user_id?: string; work_date?: string };
  action: (fd: FormData) => Promise<void>;
}) {
  const [userId, setUserId] = useState(initial.user_id ?? "");
  const [date, setDate] = useState(initial.work_date ?? "");
  const [start, setStart] = useState("09:00");
  const [hours, setHours] = useState("2");
  const [jobId, setJobId] = useState("");
  const [scopeId, setScopeId] = useState("");

  const person = people.find((p) => p.id === userId);
  const job = jobs.find((j) => j.id === jobId);
  const scope = job?.scope.find((s) => s.id === scopeId);
  const day = (person && date && booked[person.id]?.[date]) || [];
  const jobLeft = job ? (job.budget > 0 ? Math.max(0, job.budget - job.logged - job.ahead) : null) : undefined;
  const scopeLeft = scope ? (scope.unit === "hours" ? Math.max(0, scope.quantity - scope.logged - scope.ahead) : null) : undefined;

  const problems = useMemo(
    () =>
      person && date && job && scope && Number(hours) > 0
        ? bookingProblems({ date, start, hours: Number(hours) }, { today, dayCapacity: person.day_capacity, sameDay: day, jobHoursLeft: jobLeft ?? null, scopeHoursLeft: scopeLeft ?? null, scopeName: scope.name })
        : [],
    [person, date, start, hours, job, scope, day, jobLeft, scopeLeft, today],
  );
  const ready = Boolean(person && date && job && scope && Number(hours) > 0);
  const free = person ? person.day_capacity - day.reduce((s, b) => s + b.hours, 0) : 0;

  return (
    <form action={action} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <input type="hidden" name="week" value={week} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who" className="sm:col-span-2">
          <select name="user_id" value={userId} onChange={(e) => setUserId(e.target.value)} required>
            <option value="" disabled>Choose a designer or developer…</option>
            {TEAMS.filter((t) => people.some((p) => p.team === t.key)).map((t) => (
              <optgroup key={t.key} label={t.label}>
                {people.filter((p) => p.team === t.key).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {p.title}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input type="date" name="work_date" min={today} value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <input type="time" name="start_time" step={900} min="07:00" max="18:45" value={start} onChange={(e) => setStart(e.target.value)} required />
          </Field>
          <Field label="Hours">
            <input type="number" name="hours" min={0.25} max={12} step={0.25} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} required />
          </Field>
        </div>
        <Field label="Job" className="sm:col-span-2">
          <select name="job_id" value={jobId} onChange={(e) => (setJobId(e.target.value), setScopeId(""))} required>
            <option value="" disabled>Choose a live job…</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Scope" className="sm:col-span-2" hint={job && !job.scope.length ? "This job has no agreed scope yet. Lock its scope before booking." : "The part of the agreed scope this work is for."}>
          <select name="scope_item_id" value={scopeId} onChange={(e) => setScopeId(e.target.value)} required disabled={!job?.scope.length}>
            <option value="" disabled>{job ? "Choose a scope item…" : "Choose a job first"}</option>
            {job?.scope.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.unit === "hours" ? `(${h(Math.max(0, s.quantity - s.logged - s.ahead))} left)` : `(${s.quantity} ${s.quantity === 1 ? "deliverable" : "deliverables"})`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What's the work?" className="sm:col-span-2" hint="Becomes the task on their My Day.">
          <input name="title" maxLength={200} placeholder="e.g. Homepage hero options" required />
        </Field>
        <Field label="Notes (optional)" className="sm:col-span-2">
          <textarea name="notes" rows={2} maxLength={1000} placeholder="Links, files, who to ask" />
        </Field>
      </div>

      <aside className="space-y-3 rounded-lg border border-line bg-surface-2/50 p-4 text-sm">
        <h3 className="font-semibold">Check</h3>
        <dl className="space-y-2.5">
          <div>
            <dt className="text-xs text-ink-3">Their time</dt>
            <dd>
              {!person ? <span className="text-ink-3">Choose who</span> : !date ? <span className="text-ink-3">Choose a date</span> : (
                <>
                  <b className="tnum font-medium">{h(Math.max(0, free))}</b> free of {h(person.day_capacity)} on {formatShort(date)}
                  {day.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-ink-3">{day.map((b, i) => <li key={i}>{b.start}–{endTime(b.start, b.hours)} {b.title}</li>)}</ul>}
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Job time</dt>
            <dd>
              {!job ? <span className="text-ink-3">Choose a job</span> : jobLeft === null ? <span className="text-warning-ink">No hours budget on this job</span> : (
                <>
                  <b className="tnum font-medium">{h(jobLeft!)}</b> left of {h(job.budget)}
                  <div className="text-xs text-ink-3">{h(job.logged)} logged · {h(job.ahead)} already booked</div>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Scope</dt>
            <dd>
              {!scope ? <span className="text-ink-3">Choose a scope item</span> : scopeLeft === null ? (
                <>{scope.name} <span className="text-xs text-ink-3">(deliverable-based)</span></>
              ) : (
                <>
                  <b className="tnum font-medium">{h(scopeLeft!)}</b> left in {scope.name}
                </>
              )}
            </dd>
          </div>
        </dl>
        {ready && (
          <div className={cx("rounded-md p-2.5 text-xs", problems.length ? "bg-critical/10 text-critical-ink" : "bg-good/10 text-good-ink")}>
            {problems.length ? (
              <ul className="space-y-1">{problems.map((p) => <li key={p} className="flex gap-1.5"><WarningCircle aria-hidden size={14} className="mt-px shrink-0" />{p}</li>)}</ul>
            ) : (
              <span className="flex gap-1.5"><CheckCircle aria-hidden size={14} className="mt-px shrink-0" /> {person!.name.split(" ")[0]} is free {start}–{endTime(start, Number(hours))}, and it fits the job and scope.</span>
            )}
          </div>
        )}
        <SubmitButton disabled={!ready || problems.length > 0} className={cx(buttonClass("primary"), "w-full")}>Book {person ? person.name.split(" ")[0] : "time"}</SubmitButton>
      </aside>
    </form>
  );
}

"use server";
import { act, num, opt, str, withParam } from "@/lib/actions";
import { requireUser, tenant } from "@/lib/auth";
import { assertCan } from "@/lib/permissions";
import { deleteTimeEntry, logTime, lockTimeUntil, startTimer, stopTimer, timesheetSuggestions, type TimeCategory } from "@/lib/services/time";

const back = (fd: FormData, d = "/app/time") => str(fd, "back") || d;

export async function startTimerAction(fd: FormData) {
  const user = await requireUser();
  await act(back(fd, "/app/my-day"), () => tenant(user, async (tx) => void (await startTimer(tx, user.id, str(fd, "job_id"), opt(fd, "task_id")))));
}

export async function stopTimerAction(fd: FormData) {
  const user = await requireUser();
  const target = back(fd, "/app/time");
  await act(target, () =>
    tenant(user, async (tx) => {
      const entry = await stopTimer(tx, user.id);
      return withParam(target, "ok", entry ? "Timer stopped and time logged." : "Timer stopped. Under 3 minutes, so nothing was logged.");
    }),
  );
}

export async function logTimeAction(fd: FormData) {
  const user = await requireUser();
  await act(back(fd), () =>
    tenant(user, async (tx) => {
      const [jobId, taskId] = str(fd, "job_task").split(":");
      await logTime(tx, user.id, {
        job_id: jobId || str(fd, "job_id"),
        task_id: taskId || opt(fd, "task_id"),
        work_date: str(fd, "work_date"),
        hours: num(fd, "hours"),
        category: (str(fd, "category") || undefined) as TimeCategory | undefined,
        notes: str(fd, "notes"),
        oos_resolution: (str(fd, "oos_resolution") || undefined) as "change_request" | "absorbed" | undefined,
        absorb_reason: str(fd, "absorb_reason"),
        closed_job_override: str(fd, "closed_job_override"),
      });
    }),
  "Time logged.");
}

/** Confirm the day's pre-filled suggestions in one go (M13: a full day in under two minutes). */
export async function confirmSuggestionsAction(fd: FormData) {
  const user = await requireUser();
  const date = str(fd, "work_date");
  await act(back(fd), () =>
    tenant(user, async (tx) => {
      const suggestions = await timesheetSuggestions(tx, user.id, date);
      for (const s of suggestions) {
        const key = `${s.job_id}:${s.task_id ?? ""}`;
        if (str(fd, `skip:${key}`)) continue;
        const hours = num(fd, `hours:${key}`) || s.hours;
        if (hours <= 0) continue;
        await logTime(tx, user.id, {
          job_id: s.job_id,
          task_id: s.task_id,
          work_date: date,
          hours,
          source: "suggestion",
          oos_resolution: s.out_of_scope && !s.has_change_request ? "change_request" : undefined,
        });
      }
    }),
  "Day confirmed.");
}

export async function deleteTimeAction(fd: FormData) {
  const user = await requireUser();
  await act(back(fd), () => tenant(user, (tx) => deleteTimeEntry(tx, user.id, str(fd, "id"))));
}

export async function lockTimeAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "billing");
  await act(back(fd, "/app/billing?tab=close"), () => tenant(user, (tx) => lockTimeUntil(tx, str(fd, "until"))), "Time locked.");
}

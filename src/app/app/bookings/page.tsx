import { CaretLeft, CaretRight } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { BookingForm } from "@/components/BookingForm";
import { SubmitButton } from "@/components/SubmitButton";
import { Avatar, Card, Empty, PageHeader, buttonClass, cx } from "@/components/ui";
import { cancelBookingAction, createBookingAction, declineBookingAction } from "../_actions/bookings";
import { requireUser, tenant, requireModule } from "@/lib/auth";
import { endTime, TEAMS } from "@/lib/domain/bookings";
import { modulesOf } from "@/lib/domain/modules";
import { addDays, formatShort, isWeekday, startOfWeek, todayIn } from "@/lib/domain/dates";
import { bookableJobs, bookablePeople, bookingsBetween, type BookingRow } from "@/lib/services/bookings";

export const metadata = { title: "Book time" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const h = (n: number) => `${Math.round(n * 100) / 100}h`;
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", timeZone: "UTC" });

function BookingLine({ b, children }: { b: BookingRow; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="font-medium">{b.title}</div>
        <div className="text-xs text-ink-3">
          {formatShort(b.work_date)}, {b.start_time}–{endTime(b.start_time, b.hours)} ({h(b.hours)}) · <Link href={`/app/jobs/${b.job_id}`} className="hover:underline">{b.job_label}</Link> · {b.scope_name}
        </div>
        {b.notes && <div className="mt-1 text-sm text-ink-2">{b.notes}</div>}
      </div>
      {children}
    </li>
  );
}

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ week?: string; person?: string; date?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  requireModule(user, "bookings");
  const today = todayIn(user.timezone);
  // On a weekend, open on the coming week rather than one that's over.
  const week = startOfWeek(ISO.test(sp.week ?? "") ? sp.week! : isWeekday(today) ? today : addDays(today, 2));
  const days = [0, 1, 2, 3, 4].map((i) => addDays(week, i));

  const data = await tenant(user, async (tx) => {
    const horizon = addDays(today > week ? today : week, 70);
    return {
      people: await bookablePeople(tx),
      jobs: await bookableJobs(tx),
      upcoming: await bookingsBetween(tx, week < today ? week : today, horizon),
      mine: await bookingsBetween(tx, today, addDays(today, 365), { userId: user.id }),
      byMe: await bookingsBetween(tx, today, addDays(today, 365), { bookedBy: user.id }),
    };
  });

  const booked: Record<string, Record<string, { start: string; hours: number; title: string }[]>> = {};
  for (const b of data.upcoming) ((booked[b.user_id] ??= {})[b.work_date] ??= []).push({ start: b.start_time, hours: b.hours, title: b.title });
  const cell = (uid: string, d: string) => data.upcoming.filter((b) => b.user_id === uid && b.work_date === d);
  const prefill = { user_id: data.people.some((p) => p.id === sp.person) ? sp.person : undefined, work_date: ISO.test(sp.date ?? "") ? sp.date : undefined };

  return (
    <>
      <PageHeader title="Book time" subtitle="Reserve time from the design and web teams on a job: when, for how long, and which part of the agreed scope. It lands on their My Day as a task." />

      <Card
        pad={false}
        title={`Week of ${formatShort(week)}`}
        actions={
          <div className="flex items-center gap-1">
            <Link href={`/app/bookings?week=${addDays(week, -7)}`} aria-label="Previous week" className={buttonClass("ghost", "sm")}><CaretLeft aria-hidden size={14} /></Link>
            <Link href="/app/bookings" className={buttonClass("ghost", "sm")}>{isWeekday(today) ? "This week" : "Next week"}</Link>
            <Link href={`/app/bookings?week=${addDays(week, 7)}`} aria-label="Next week" className={buttonClass("ghost", "sm")}><CaretRight aria-hidden size={14} /></Link>
          </div>
        }
      >
        {data.people.length === 0 ? (
          <div className="p-4"><Empty>Nobody is in the design or web team yet. Set each person's team in Settings › Team.</Empty></div>
        ) : (
          <div className="overflow-x-auto" tabIndex={0}>
            <table className="w-full min-w-[760px] table-fixed text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/60 text-left text-xs font-medium text-ink-3">
                  <th className="w-52 px-4 py-2.5 font-medium">Person</th>
                  {days.map((d) => (
                    <th key={d} className={cx("px-2 py-2.5 font-medium", d === today && "text-brand")}>{dayLabel(d)}</th>
                  ))}
                </tr>
              </thead>
              {TEAMS.filter((t) => data.people.some((p) => p.team === t.key)).map((t) => (
                <tbody key={t.key} className="divide-y divide-line border-b border-line">
                  <tr className="bg-surface-2/30">
                    <th colSpan={6} className="px-4 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-3">{t.label}</th>
                  </tr>
                  {data.people.filter((p) => p.team === t.key).map((p) => (
                    <tr key={p.id} className="align-top">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar name={p.name} size="sm" />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{p.name}</div>
                            <div className="truncate text-xs text-ink-3">{p.title}</div>
                          </div>
                        </div>
                      </td>
                      {days.map((d) => {
                        const items = cell(p.id, d);
                        const used = items.reduce((s, b) => s + b.hours, 0);
                        const free = Math.max(0, p.day_capacity - used);
                        const past = d < today;
                        return (
                          <td key={d} className={cx("px-2 py-2", past && "opacity-50")}>
                            <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
                              <div className={cx("h-full rounded-full", free === 0 ? "bg-critical" : used / p.day_capacity > 0.75 ? "bg-warning" : "bg-seq")} style={{ width: `${Math.min(100, (used / p.day_capacity) * 100)}%` }} />
                            </div>
                            <ul className="space-y-1">
                              {items.map((b) => (
                                <li key={b.id} title={`${b.title} · ${b.job_label} · booked by ${b.booked_by_name ?? "someone"}`} className="truncate rounded bg-brand/10 px-1.5 py-0.5 text-xs text-ink-2">
                                  <span className="tnum font-medium text-ink">{b.start_time}</span> {b.title}
                                </li>
                              ))}
                            </ul>
                            {!past && free > 0 ? (
                              <Link href={`/app/bookings?week=${week}&person=${p.id}&date=${d}#book`} className="mt-1 inline-block rounded text-xs font-medium text-brand hover:underline pointer-coarse:py-2">
                                {h(free)} free · Book
                              </Link>
                            ) : (
                              <span className="mt-1 inline-block text-xs text-ink-3">{past ? "" : "Fully booked"}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </Card>

      <Card id="book" title="Book someone" className="mt-4 scroll-mt-24">
        <BookingForm key={`${prefill.user_id}:${prefill.work_date}`} people={data.people} jobs={data.jobs} booked={booked} today={today} week={week} initial={prefill} strict={modulesOf(user.modules).booking_mode === "strict"} action={createBookingAction} />
      </Card>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <Card id="mine" title="Booked for you" pad={false} className="scroll-mt-24">
          {data.mine.length ? (
            <ul className="divide-y divide-line">
              {data.mine.map((b) => (
                <BookingLine key={b.id} b={b}>
                  <details className="text-sm">
                    <summary className="cursor-pointer list-none text-ink-3 hover:text-critical-ink pointer-coarse:py-2 [&::-webkit-details-marker]:hidden">Can&apos;t do it?</summary>
                    <form action={declineBookingAction} className="mt-2 flex gap-2">
                      <input type="hidden" name="id" value={b.id} />
                      <input name="reason" required placeholder="Why (they'll see this)" className="field-sm" aria-label="Reason" />
                      <SubmitButton className={buttonClass("danger", "sm")}>Decline</SubmitButton>
                    </form>
                  </details>
                  <div className="w-full text-xs text-ink-3">Booked by {b.booked_by_name ?? "someone"}</div>
                </BookingLine>
              ))}
            </ul>
          ) : (
            <div className="p-4"><Empty>Nobody has booked your time.</Empty></div>
          )}
        </Card>
        <Card title="You booked" pad={false}>
          {data.byMe.length ? (
            <ul className="divide-y divide-line">
              {data.byMe.map((b) => (
                <BookingLine key={b.id} b={b}>
                  <form action={cancelBookingAction}>
                    <input type="hidden" name="id" value={b.id} />
                    <SubmitButton confirm={`Cancel ${b.user_name}'s booking for “${b.title}”?`} className={buttonClass("ghost", "sm")}>Cancel</SubmitButton>
                  </form>
                  <div className="w-full text-xs text-ink-3">{b.user_name}</div>
                </BookingLine>
              ))}
            </ul>
          ) : (
            <div className="p-4"><Empty>You haven&apos;t booked anyone yet.</Empty></div>
          )}
        </Card>
      </div>
    </>
  );
}

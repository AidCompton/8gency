"use server";
import { act, num, str } from "@/lib/actions";
import { assertModule, requireUser, tenant } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cancelBooking, createBooking, declineBooking } from "@/lib/services/bookings";
import { UserError } from "@/lib/services/core";

const BACK = "/app/bookings";

export async function createBookingAction(fd: FormData) {
  const user = await requireUser();
  assertModule(user, "bookings");
  const back = `${BACK}?week=${encodeURIComponent(str(fd, "week"))}`;
  await act(back, () =>
    tenant(user, async (tx) => {
      await createBooking(tx, {
        user_id: str(fd, "user_id"),
        job_id: str(fd, "job_id"),
        scope_item_id: str(fd, "scope_item_id"),
        work_date: str(fd, "work_date"),
        start_time: str(fd, "start_time"),
        hours: num(fd, "hours"),
        title: str(fd, "title"),
        notes: str(fd, "notes"),
      });
    }),
  "Booked. It's on their My Day as a task.");
}

/** The person booked (or a manager) can say no, with a reason. */
export async function declineBookingAction(fd: FormData) {
  const user = await requireUser();
  assertModule(user, "bookings");
  await act(BACK, () =>
    tenant(user, async (tx) => {
      const b = await tx.one<{ user_id: string }>("select user_id from bookings where id = $1", [str(fd, "id")]);
      if (!b || (b.user_id !== user.id && !can(user, "seeTeamTime"))) throw new UserError("Only the person booked can decline it.");
      await declineBooking(tx, str(fd, "id"), str(fd, "reason"));
    }),
  "Declined. They've been told why.");
}

/** Whoever made the booking (or a manager) can cancel it. */
export async function cancelBookingAction(fd: FormData) {
  const user = await requireUser();
  assertModule(user, "bookings");
  await act(BACK, () =>
    tenant(user, async (tx) => {
      const b = await tx.one<{ booked_by: string | null }>("select booked_by from bookings where id = $1", [str(fd, "id")]);
      if (!b || (b.booked_by !== user.id && !can(user, "seeTeamTime"))) throw new UserError("Only whoever made the booking can cancel it.");
      await cancelBooking(tx, str(fd, "id"));
    }),
  "Booking cancelled.");
}

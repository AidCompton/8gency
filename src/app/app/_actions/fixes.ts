"use server";
import { act, str, withParam } from "@/lib/actions";
import { requireUser, tenant } from "@/lib/auth";
import { assertCan, type Capability } from "@/lib/permissions";
import { UserError } from "@/lib/services/core";
import { applyFix, type FixKind } from "@/lib/services/fixes";

const NEEDS: Record<FixKind, Capability> = { invoice: "billing", reminder: "billing", change_request: "createChangeRequests", reconcile: "createChangeRequests", budget: "manageJobs" };

/** One click on a leak: does the work, then lands on the draft to review (or shows what happened). */
export async function fixAction(fd: FormData) {
  const user = await requireUser();
  const kind = str(fd, "kind") as FixKind;
  if (!(kind in NEEDS)) throw new UserError("Unknown fix.");
  assertCan(user, NEEDS[kind]);
  const back = str(fd, "back").startsWith("/app") ? str(fd, "back") : "/app/pulse";
  await act(back, async () => {
    const r = await tenant(user, (tx) => applyFix(tx, kind, str(fd, "id")));
    return r.href ? withParam(r.href, "ok", r.message ?? "Done.") : withParam(back, "ok", r.message ?? "Done.");
  });
}

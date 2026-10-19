"use server";
import { act, num, opt, str } from "@/lib/actions";
import { requireUser, tenant } from "@/lib/auth";
import { toCents } from "@/lib/domain/money";
import { assertCan } from "@/lib/permissions";
import { createRetainer, reconcilePeriod } from "@/lib/services/retainers";

export async function createRetainerAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  await act("/app/retainers/new", () =>
    tenant(user, async (tx) => {
      const id = await createRetainer(tx, {
        company_id: str(fd, "company_id"),
        name: str(fd, "name"),
        fee_cents: toCents(str(fd, "fee")),
        hours_per_period: num(fd, "hours"),
        start_date: str(fd, "start_date"),
        rollover: str(fd, "rollover") === "capped" ? "capped" : "none",
        rollover_cap_hours: num(fd, "rollover_cap_hours"),
        billing_timing: str(fd, "billing_timing") === "arrears" ? "arrears" : "advance",
        price_increase_pct: num(fd, "price_increase_pct"),
        job_template_key: opt(fd, "job_template_key"),
        job_owner_id: opt(fd, "job_owner_id"),
        scope: str(fd, "deliverables")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const m = l.match(/^(\d+(?:\.\d+)?)\s*(h|hours?)?\s+(.+)$/i);
            return m
              ? { name: m[3], unit: m[2] ? ("hours" as const) : ("deliverable" as const), quantity: Number(m[1]), rounds: m[2] ? 0 : 1 }
              : { name: l, unit: "deliverable" as const, quantity: 1, rounds: 1 };
          }),
      });
      return `/app/retainers/${id}`;
    }),
  "Retainer created. This month's period and recurring job are open.");
}

export async function reconcileAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "billing");
  const id = str(fd, "retainer_id");
  await act(`/app/retainers/${id}`, () =>
    tenant(user, async (tx) => {
      await reconcilePeriod(tx, str(fd, "period_id"), str(fd, "action") === "absorbed" ? "absorbed" : "change_request", str(fd, "reason"));
    }),
  "Period reconciled.");
}

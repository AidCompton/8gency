import { SubmitButton } from "@/components/SubmitButton";
import { createRetainerAction } from "../../_actions/retainers";
import { Card, Field, PageHeader, buttonClass } from "@/components/ui";
import { requireCap, requireUser, tenant } from "@/lib/auth";
import { startOfMonth, todayIn } from "@/lib/domain/dates";

import { JOB_TEMPLATES } from "@/lib/templates";

export const metadata = { title: "New retainer" };

export default async function NewRetainer() {
  const user = await requireUser();
  requireCap(user, "manageJobs");
  const { companies, users } = await tenant(user, async (tx) => ({
    companies: await tx.q<{ id: string; name: string }>("select id, name from companies where kind = 'client' and status <> 'former' order by name"),
    users: await tx.q<{ id: string; name: string }>("select id, name from users where active order by name"),
  }));
  return (
    <>
      <PageHeader title="New retainer" back={{ href: "/app/retainers", label: "Retainers" }} subtitle="An hours bank, a deliverables bank, or both — with rollover rules and an annual increase." />
      <Card className="max-w-3xl">
        <form action={createRetainerAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="Client"><select name="company_id" required defaultValue=""><option value="" disabled>Choose…</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Name"><input name="name" required placeholder="e.g. Always-on social" /></Field>
          <Field label="Monthly fee (excl. VAT)"><input name="fee" required inputMode="decimal" /></Field>
          <Field label="Hours per month"><input name="hours" required inputMode="decimal" /></Field>
          <Field label="Starts"><input type="date" name="start_date" defaultValue={startOfMonth(todayIn(user.timezone))} required /></Field>
          <Field label="Billing"><select name="billing_timing"><option value="advance">In advance (month start)</option><option value="arrears">In arrears (after month end)</option></select></Field>
          <Field label="Rollover of unused hours"><select name="rollover"><option value="none">None — use it or lose it</option><option value="capped">Capped rollover</option></select></Field>
          <Field label="Rollover cap (hours)"><input name="rollover_cap_hours" defaultValue="0" /></Field>
          <Field label="Annual price increase %" hint="Applied on the anniversary (PR-07)."><input name="price_increase_pct" defaultValue="6" /></Field>
          <Field label="Recurring monthly job"><select name="job_template_key" defaultValue="social_month"><option value="">None</option>{JOB_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></Field>
          <Field label="Recurring job owner"><select name="job_owner_id" defaultValue={user.id}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          <Field label="What's included each month" hint="One per line. “12 social posts”, “10h community management”." className="sm:col-span-2"><textarea name="deliverables" placeholder={"12 social posts\n1 monthly report\n10h community management"} /></Field>
          <div><SubmitButton className={buttonClass("primary")}>Create retainer</SubmitButton></div>
        </form>
      </Card>
    </>
  );
}

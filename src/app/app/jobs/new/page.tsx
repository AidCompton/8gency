import { SubmitButton } from "@/components/SubmitButton";
import { createJobAction } from "../../_actions/jobs";
import { Card, Field, PageHeader, buttonClass } from "@/components/ui";
import { requireCap, requireUser, tenant } from "@/lib/auth";

import { JOB_TEMPLATES, TEMPLATES_BY_TYPE, type AgencyType } from "@/lib/templates";

export const metadata = { title: "New job" };

export default async function NewJob({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  requireCap(user, "manageJobs");
  const { companies, users, retainers, type } = await tenant(user, async (tx) => ({
    companies: await tx.q<{ id: string; name: string }>("select id, name from companies where kind = 'client' and status <> 'former' order by name"),
    users: await tx.q<{ id: string; name: string }>("select id, name from users where active order by name"),
    retainers: await tx.q<{ id: string; name: string; company_name: string }>("select r.id, r.name, c.name as company_name from retainers r join companies c on c.id = r.company_id where r.status = 'active' order by c.name"),
    type: (await tx.one<{ agency_type: AgencyType }>("select agency_type from agencies where id = $1", [tx.agencyId]))!.agency_type,
  }));
  const keys = TEMPLATES_BY_TYPE[type] ?? TEMPLATES_BY_TYPE.full_service;
  const templates = [...keys.map((k) => JOB_TEMPLATES.find((t) => t.key === k)!), ...JOB_TEMPLATES.filter((t) => !keys.includes(t.key))];
  return (
    <>
      <PageHeader title="New job" back={{ href: "/app/jobs", label: "Jobs" }} subtitle="The template loads phases, tasks, scope items and a billing schedule. You approve the scope before work starts." />
      <Card className="max-w-3xl">
        <form action={createJobAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="Client">
            <select name="company_id" required defaultValue={sp.company ?? ""}>
              <option value="" disabled>Choose…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Job name"><input name="name" required placeholder="e.g. Summer campaign launch" /></Field>
          <Field label="Template">
            <select name="template_key" defaultValue={templates[0].key}>
              {templates.map((t) => <option key={t.key} value={t.key}>{t.name} ({t.scope.length} scope items, {t.tasks.length} tasks)</option>)}
            </select>
          </Field>
          <Field label="Billing model" hint="Leave on template default unless you know otherwise.">
            <select name="billing_model" defaultValue="">
              <option value="">Template default</option>
              <option value="fixed">Fixed fee (milestones)</option>
              <option value="tm">Time and materials</option>
              <option value="retainer">Against a retainer</option>
              <option value="internal">Internal / pitch (not billed)</option>
            </select>
          </Field>
          <Field label="Bill time to the client" hint="Billable time is added to the client's next invoice automatically, itemised by task.">
            <select name="bill_time" defaultValue="auto">
              <option value="auto">Automatic: yes for time and materials, no otherwise</option>
              <option value="yes">Yes, bill time on this job</option>
              <option value="no">No, time is covered by the fee</option>
            </select>
          </Field>
          <Field label="Retainer (if billed against one)">
            <select name="retainer_id" defaultValue="">
              <option value="">None</option>
              {retainers.map((r) => <option key={r.id} value={r.id}>{r.company_name} · {r.name}</option>)}
            </select>
          </Field>
          <Field label="Job owner">
            <select name="owner_id" defaultValue={user.id}>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Fee (fixed-fee jobs, excl. VAT)"><input name="fee" inputMode="decimal" placeholder="e.g. 85000" /></Field>
          <Field label="Budget hours" hint="Defaults to the sum of template task estimates."><input name="budget_hours" inputMode="decimal" /></Field>
          <Field label="Start date"><input type="date" name="start_date" /></Field>
          <Field label="Due date"><input type="date" name="due_date" /></Field>
          <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="rush" /> Rush job (flags the disruption cost to planned work)</label>
          <div className="sm:col-span-2"><SubmitButton className={buttonClass("primary")}>Create job</SubmitButton></div>
        </form>
      </Card>
    </>
  );
}

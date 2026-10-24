import { SubmitButton } from "@/components/SubmitButton";
import { createClientAction } from "../../_actions/clients";
import { Card, Field, PageHeader, buttonClass } from "@/components/ui";
import { requireCap, requireUser, tenant } from "@/lib/auth";


export const metadata = { title: "New client" };

export default async function NewClient() {
  const user = await requireUser();
  requireCap(user, "manageJobs");
  const users = await tenant(user, (tx) => tx.q<{ id: string; name: string }>("select id, name from users where active and role in ('owner','ops','account','pm') order by name"));
  return (
    <>
      <PageHeader title="New client" back={{ href: "/app/clients", label: "Clients" }} subtitle="Creates the client with an onboarding checklist and 30/60/90-day check-ins." />
      <Card className="max-w-2xl">
        <form action={createClientAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="Client name" className="sm:col-span-2"><input name="name" required /></Field>
          <Field label="Client code" hint="Used in job numbers. Leave blank to suggest one."><input name="code" maxLength={6} /></Field>
          <Field label="Account manager"><select name="account_manager_id" defaultValue={user.id}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          <Field label="Payment terms (days)"><input name="payment_terms_days" defaultValue="30" /></Field>
          <Field label="Billing email"><input type="email" name="billing_email" /></Field>
          <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="po_required" /> Client requires a PO number on every invoice</label>
          <div><SubmitButton className={buttonClass("primary")}>Create client</SubmitButton></div>
        </form>
      </Card>
    </>
  );
}

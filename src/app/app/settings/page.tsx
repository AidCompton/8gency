import { CheckCircle } from "@phosphor-icons/react/ssr";
import { LogoCard } from "@/components/LogoCard";
import { SubmitButton } from "@/components/SubmitButton";
import { addRateAction, addUserAction, deactivateUserAction, importAction, updateAgencyAction, updateEntityAction, updateUserAction } from "../_actions/settings";
import { Badge, Card, Field, Money, PageHeader, Table, Tabs, Td, buttonClass } from "@/components/ui";
import { requireCap, requireUser, tenant } from "@/lib/auth";
import { formatDate } from "@/lib/domain/dates";
import { can, ROLE_LABELS } from "@/lib/permissions";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; welcome?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab ?? "agency";
  const user = await requireUser();
  requireCap(user, "settings");
  const costs = can(user, "seeCostRates");
  const data = await tenant(user, async (tx) => ({
    agency: (await tx.one<{ name: string; brand_color: string; job_number_format: string; brief_threshold: number; bill_within_days: number; timezone: string; ai_enabled: boolean; agency_type: string }>("select * from agencies where id = $1", [tx.agencyId]))!,
    entity: (await tx.one<{ id: string; name: string; legal_name: string; currency: string; tax_label: string; tax_rate: number; tax_number: string; registration_number: string; address: string; bank_details: string; invoice_prefix: string; next_invoice_seq: number }>("select * from entities where is_default order by created_at limit 1"))!,
    rates: await tx.q<{ id: string; role_title: string; rate_cents: number; effective_from: string; company: string | null }>("select r.id, r.role_title, r.rate_cents, r.effective_from, c.name as company from rate_cards r left join companies c on c.id = r.company_id order by r.role_title, c.name nulls first, r.effective_from desc"),
    users: await tx.q<{ id: string; name: string; email: string; role: string; title: string; weekly_hours: number; cost_rate_cents: number; target_utilisation: number; active: boolean }>("select id, name, email, role, title, weekly_hours, cost_rate_cents, target_utilisation, active from users order by active desc, name"),
    companies: await tx.q<{ id: string; name: string }>("select id, name from companies where kind = 'client' order by name"),
  }));
  const roleTitles = [...new Set(data.rates.map((r) => r.role_title))];
  return (
    <>
      <PageHeader title="Settings" subtitle="Defaults first: everything here ships with sensible values from your agency-type template." />
      {sp.welcome && (
        <Card className="mb-5 border-brand/40 bg-brand/5">
          <h2 className="font-semibold">Welcome to 8gency. Let's get you live today.</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-2">
            <li>Import clients, then 3–12 months of time from Harvest, Toggl or a spreadsheet (below).</li>
            <li>Add your team and their roles (Team tab) so time maps to the right people and rates.</li>
            <li>Open <b>Home</b> to see your Agency Health Scan.</li>
            <li>Add approvers on each client and send their first hub links.</li>
          </ol>
        </Card>
      )}
      <Tabs base="/app/settings" active={tab} tabs={[{ key: "agency", label: "Agency" }, { key: "entity", label: "Billing entity & tax" }, { key: "rates", label: "Rate card" }, { key: "team", label: "Team" }, { key: "import", label: "Import" }, { key: "data", label: "Data & security" }]} />

      {tab === "agency" && (
        <div className="grid max-w-5xl items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Agency">
          <form action={updateAgencyAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Agency name" className="sm:col-span-2"><input name="name" defaultValue={data.agency.name} /></Field>
            <Field label="Brand colour" hint="Accents on the client hub and invoices."><input type="color" name="brand_color" defaultValue={data.agency.brand_color} className="!p-1" /></Field>
            <Field label="Time zone"><input name="timezone" defaultValue={data.agency.timezone} /></Field>
            <Field label="Job number format" hint="{CLIENT}, {YYYY}, {YY}, {SEQ}"><input name="job_number_format" defaultValue={data.agency.job_number_format} /></Field>
            <Field label="Minimum brief score to start work"><input name="brief_threshold" defaultValue={data.agency.brief_threshold} /></Field>
            <Field label="Invoice within (days)" hint="Ready-to-bill items older than this are flagged."><input name="bill_within_days" defaultValue={data.agency.bill_within_days} /></Field>
            <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="ai_enabled" defaultChecked={data.agency.ai_enabled} /> 8gent AI drafting enabled (client data is never used for training; drafts always need human review)</label>
            <div><SubmitButton className={buttonClass("primary", "sm")}>Save</SubmitButton></div>
          </form>
        </Card>
        <LogoCard logoV={user.agency_logo_v} agencyName={user.agency_name} back="/app/settings?tab=agency" />
        </div>
      )}

      {tab === "entity" && (
        <Card className="max-w-2xl">
          <form action={updateEntityAction} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="entity_id" value={data.entity.id} />
            <Field label="Trading name"><input name="name" defaultValue={data.entity.name} /></Field>
            <Field label="Legal name"><input name="legal_name" defaultValue={data.entity.legal_name} /></Field>
            <Field label="Currency"><input name="currency" defaultValue={data.entity.currency} maxLength={3} /></Field>
            <Field label="Invoice prefix" hint={`Next number: ${data.entity.invoice_prefix}${String(data.entity.next_invoice_seq).padStart(5, "0")}`}><input name="invoice_prefix" defaultValue={data.entity.invoice_prefix} /></Field>
            <Field label="Tax label"><input name="tax_label" defaultValue={data.entity.tax_label} /></Field>
            <Field label="Tax rate %" hint="SA VAT preset. Confirm the current rate with your accountant."><input name="tax_rate" defaultValue={Math.round(data.entity.tax_rate * 10000) / 100} /></Field>
            <Field label="VAT number"><input name="tax_number" defaultValue={data.entity.tax_number} /></Field>
            <Field label="Company registration number"><input name="registration_number" defaultValue={data.entity.registration_number} /></Field>
            <Field label="Address" className="sm:col-span-2"><textarea name="address" defaultValue={data.entity.address} /></Field>
            <Field label="Bank details (printed on invoices)" className="sm:col-span-2"><textarea name="bank_details" defaultValue={data.entity.bank_details} /></Field>
            <div><SubmitButton className={buttonClass("primary", "sm")}>Save</SubmitButton></div>
          </form>
        </Card>
      )}

      {tab === "rates" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card pad={false}>
            <Table head={["Role", "Client override", "Rate / hour", "Effective from"]}>
              {data.rates.map((r) => <tr key={r.id}><Td>{r.role_title}</Td><Td className="text-ink-2">{r.company ?? "All clients"}</Td><Td right><Money cents={r.rate_cents} /></Td><Td className="text-ink-2">{formatDate(r.effective_from)}</Td></tr>)}
            </Table>
          </Card>
          {costs && (
            <Card title="Add or change a rate">
              <form action={addRateAction} className="space-y-2">
                <Field label="Role"><input name="role_title" list="roles" required /><datalist id="roles">{roleTitles.map((r) => <option key={r} value={r} />)}</datalist></Field>
                <Field label="Client (optional override)"><select name="company_id" defaultValue=""><option value="">All clients</option>{data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                <Field label="Rate per hour (excl. VAT)"><input name="rate" required /></Field>
                <Field label="Effective from"><input type="date" name="effective_from" /></Field>
                <SubmitButton className={buttonClass("primary", "sm")}>Add rate</SubmitButton>
                <p className="text-xs text-ink-3">Rates never change history: each time entry keeps the rate in force on its date.</p>
              </form>
            </Card>
          )}
        </div>
      )}

      {tab === "team" && (
        <div className="space-y-4">
          <Card pad={false}>
            <Table head={["Person", "Role", "Title (sets rate)", "Hours/wk", "Target %", ...(costs ? ["Cost/hour"] : []), ""]}>
              {data.users.map((u) => {
                // Controls sit in their own cells and join the row's form via the `form` attribute.
                const f = `user-${u.id}`;
                return (
                  <tr key={u.id} className={u.active ? "" : "opacity-50"}>
                    <Td><b>{u.name}</b><div className="text-xs text-ink-3">{u.email}</div></Td>
                    {u.active ? (
                      <>
                        <Td><select form={f} name="role" aria-label={`Role for ${u.name}`} defaultValue={u.role} className="field-sm !w-40">{Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Td>
                        <Td><input form={f} name="title" aria-label={`Title for ${u.name}`} defaultValue={u.title} list="roles2" className="field-sm !w-48" /></Td>
                        <Td><input form={f} name="weekly_hours" inputMode="decimal" defaultValue={u.weekly_hours} className="field-sm !w-16 text-right" aria-label={`Hours per week for ${u.name}`} /></Td>
                        <Td><input form={f} name="target_utilisation" inputMode="numeric" defaultValue={Math.round(u.target_utilisation * 100)} className="field-sm !w-16 text-right" aria-label={`Target utilisation % for ${u.name}`} /></Td>
                        {costs && <Td><input form={f} name="cost_rate" inputMode="decimal" defaultValue={(u.cost_rate_cents / 100).toFixed(2)} className="field-sm !w-24 text-right" aria-label={`Cost per hour for ${u.name}`} /></Td>}
                        <Td>
                          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                            <form id={f} action={updateUserAction}>
                              <input type="hidden" name="user_id" value={u.id} />
                              {!costs && <input type="hidden" name="cost_rate" value={(u.cost_rate_cents / 100).toFixed(2)} />}
                              <SubmitButton className={buttonClass("secondary", "sm")}>Save</SubmitButton>
                            </form>
                            {u.id !== user.id && (
                              <form action={deactivateUserAction}>
                                <input type="hidden" name="user_id" value={u.id} />
                                <SubmitButton confirm={`Remove ${u.name}'s access? Their sessions and timers end today.`} className={buttonClass("danger", "sm")}>Remove</SubmitButton>
                              </form>
                            )}
                          </div>
                        </Td>
                      </>
                    ) : (
                      <Td colSpan={costs ? 6 : 5}><Badge>Deactivated</Badge></Td>
                    )}
                  </tr>
                );
              })}
            </Table>
            <datalist id="roles2">{roleTitles.map((r) => <option key={r} value={r} />)}</datalist>
          </Card>
          <Card title="Add a team member" className="max-w-3xl">
            <form action={addUserAction} className="grid gap-3 sm:grid-cols-3">
              <Field label="Name"><input name="name" required /></Field>
              <Field label="Email"><input type="email" name="email" required /></Field>
              <Field label="Temporary password"><input name="password" required minLength={8} /></Field>
              <Field label="Permission role"><select name="role" defaultValue="staff">{Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="Title (sets their rate)"><input name="title" list="roles2" defaultValue="Designer" /></Field>
              <Field label="Hours per week"><input name="weekly_hours" defaultValue="40" /></Field>
              <Field label="Target utilisation %"><input name="target_utilisation" defaultValue="70" /></Field>
              {costs && <Field label="Cost per hour"><input name="cost_rate" /></Field>}
              <div className="flex items-end"><SubmitButton className={buttonClass("primary", "sm")}>Add</SubmitButton></div>
            </form>
            <p className="mt-2 text-xs text-ink-3">Removing access ends sessions and timers the same day (Rule 14).</p>
          </Card>
        </div>
      )}

      {tab === "import" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Import a CSV">
            <form action={importAction} className="space-y-3">
              <Field label="What's in the file?">
                <select name="kind" defaultValue="time">
                  <option value="clients">Clients (name, code, billing email, po required, payment terms)</option>
                  <option value="time">Time (Harvest / Toggl export: date, client, project, task, hours, email, billable, notes)</option>
                  <option value="tasks">Tasks (Asana / Monday / ClickUp / Trello: name, project, client, assignee email, due date, status)</option>
                </select>
              </Field>
              <Field label="CSV file"><input type="file" name="file" accept=".csv,text/csv" required /></Field>
              <SubmitButton className={buttonClass("primary", "sm")}>Import</SubmitButton>
            </form>
          </Card>
          <Card title="How mapping works">
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
              <li>Column names are matched case-insensitively (e.g. “Spent Date” or “Date”, “Hours” or “Duration”).</li>
              <li>Missing clients and projects are created, so every hour lands on a job.</li>
              <li>People are matched by email or name. Add your team first.</li>
              <li>Imported time takes the rate card in force on each date.</li>
              <li>Dates as YYYY-MM-DD or DD/MM/YYYY.</li>
            </ul>
            <p className="mt-3 text-xs text-ink-3">Direct API connectors for Asana, Harvest and Xero are on the roadmap; CSV works with all of them today.</p>
          </Card>
        </div>
      )}

      {tab === "data" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Export your data">
            <p className="text-sm text-ink-2">You own your data. Export everything in open formats at any time.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className={buttonClass("secondary", "sm")} href="/api/export/all">Everything (JSON)</a>
              <a className={buttonClass("secondary", "sm")} href="/api/export/time">Time entries (CSV)</a>
            </div>
            <p className="mt-2 text-xs text-ink-3">Exports respect field permissions: cost rates are only included for finance roles. Every export is audit-logged.</p>
          </Card>
          <Card title="Security">
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
              <li>Tenant isolation is enforced by Postgres row-level security on every table.</li>
              <li>Approvals and the audit log are immutable at the database level.</li>
              <li>Client hub links are random, expire after 180 days and are revoked instantly.</li>
              <li>SSO (Google, Microsoft) and 2FA are planned for this module; today staff sign in with email and password.</li>
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}

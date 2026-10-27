import { getSessionUser, tenant } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { xeroCsv } from "@/lib/services/billing";

const csv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k] instanceof Date ? (r[k] as Date).toISOString() : r[k])).join(","))].join("\n");
};

/**
 * Data ownership (M27): agencies can export their data in open formats at any
 * time. Cost rates and margins are excluded for users without finance access.
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorised", { status: 401 });
  const { kind } = await params;
  const url = new URL(req.url);
  const costs = can(user, "seeCostRates");
  const file = (name: string, body: string, type = "text/csv") =>
    new Response(body, { headers: { "content-type": `${type}; charset=utf-8`, "content-disposition": `attachment; filename="${name}"` } });

  if (kind === "xero") {
    if (!can(user, "billing")) return new Response("Forbidden", { status: 403 });
    const from = url.searchParams.get("from") ?? "1900-01-01";
    const to = url.searchParams.get("to") ?? "2999-12-31";
    const body = await tenant(user, async (tx) => {
      await tx.audit("export.xero", "agency", tx.agencyId, undefined, { from, to });
      return xeroCsv(tx, from, to);
    });
    return file(`xero-invoices-${from}-to-${to}.csv`, body);
  }
  if (kind === "time") {
    if (!can(user, "seeAllJobs")) return new Response("Forbidden", { status: 403 });
    const rows = await tenant(user, async (tx) => {
      await tx.audit("export.time", "agency", tx.agencyId);
      return tx.q(
        `select te.work_date, u.name as person, u.email, c.name as client, j.number as job, j.name as job_name, t.title as task, te.hours, te.category,
                te.out_of_scope, te.oos_resolution, te.notes, te.rate_cents::numeric/100 as rate${costs ? ", te.cost_cents::numeric/100 as cost_rate" : ""}
           from time_entries te join users u on u.id = te.user_id join jobs j on j.id = te.job_id join companies c on c.id = j.company_id
           left join tasks t on t.id = te.task_id order by te.work_date`,
      );
    });
    return file("time-entries.csv", csv(rows));
  }
  if (kind === "all") {
    if (!can(user, "settings")) return new Response("Forbidden", { status: 403 });
    const body = await tenant(user, async (tx) => {
      await tx.audit("export.all", "agency", tx.agencyId);
      const tables = ["companies", "contacts", "jobs", "briefs", "scope_items", "tasks", "deliverables", "versions", "approvals", "change_requests", "client_requests",
        "time_entries", "retainers", "retainer_periods", "invoices", "invoice_lines", "write_offs", "costs", "contracts", "milestones", "rate_cards", "audit_events"];
      const out: Record<string, unknown[]> = {};
      for (const t of tables) out[t] = await tx.q(`select * from ${t}`);
      out.users = await tx.q(`select id, email, name, role, title, weekly_hours, target_utilisation${costs ? ", cost_rate_cents" : ""}, active, created_at from users`);
      if (!costs) for (const r of out.time_entries as Record<string, unknown>[]) delete r.cost_cents;
      for (const r of out.contacts as Record<string, unknown>[]) delete r.hub_token;
      return JSON.stringify({ exported_at: new Date().toISOString(), agency: user.agency_name, ...out }, null, 2);
    });
    return file("8gency-export.json", body, "application/json");
  }
  return new Response("Unknown export", { status: 404 });
}

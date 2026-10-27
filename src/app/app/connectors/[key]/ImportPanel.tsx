import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, Empty, Field, Table, Td, buttonClass } from "@/components/ui";
import { suggestClient } from "@/lib/domain/imports";
import { mapAllTogglProjectsAction, mapTogglProjectAction, mapTrelloBoardAction, matchTogglPersonAction } from "../../_actions/connectors";
import type { togglPanel } from "@/lib/connectors/toggl";
import type { trelloPanel } from "@/lib/connectors/trello";

type Clients = { id: string; name: string }[];

const note = "text-xs text-ink-3";

/** Toggl: match people, then turn each project into a job that is waiting for its scope. */
export function TogglPanel({ connId, data, clients, team }: { connId: string; data: Awaited<ReturnType<typeof togglPanel>>; clients: Clients; team: { id: string; name: string }[] }) {
  const todo = data.projects.filter((p) => !p.job_id && p.active);
  const s = data.status;
  return (
    <div className="space-y-5 border-t border-line pt-4">
      <div>
        <h3 className="text-sm font-semibold">What we've read from Toggl</h3>
        <p className="mt-1 text-sm text-ink-2">
          {s.projects} projects and {s.entries} time entries. <b className="font-medium">{s.applied}</b> are on jobs in 8gency already. Nothing is written back to Toggl: keep working there as normal.
        </p>
      </div>

      {data.people.some((p) => !p.matched_id) && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Match people to your team</h3>
          <p className={`mb-2 ${note}`}>Time is only added for people we can match, by email. Pick who each Toggl person is, or leave it.</p>
          <Table head={["In Toggl", "In 8gency", ""]}>
            {data.people.filter((p) => !p.matched_id).map((p) => (
              <tr key={p.external_id}>
                <Td><div className="font-medium">{p.name}</div><div className={note}>{p.email}</div></Td>
                <Td colSpan={2}>
                  <form action={matchTogglPersonAction} className="flex gap-2">
                    <input type="hidden" name="connection_id" value={connId} />
                    <input type="hidden" name="toggl_user_id" value={p.external_id} />
                    <select name="user_id" className="field-sm" aria-label={`Match ${p.name}`} defaultValue="" required>
                      <option value="" disabled>Choose…</option>
                      {team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <SubmitButton className={buttonClass("secondary", "sm")}>Match</SubmitButton>
                  </form>
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Projects</h3>
          {todo.length > 1 && (
            <form action={mapAllTogglProjectsAction}>
              <input type="hidden" name="connection_id" value={connId} />
              <SubmitButton className={buttonClass("primary", "sm")}>Create jobs for all {todo.length}</SubmitButton>
            </form>
          )}
        </div>
        <p className={`mb-2 ${note}`}>Each project becomes a job waiting for its scope. We match the client by name, or create it from the Toggl client.</p>
        <Table head={["Project", "Hours", "Job in 8gency"]} empty={<Empty>No projects read yet. Click Sync now.</Empty>}>
          {data.projects.map((p) => (
            <tr key={p.external_id} className={p.active ? "" : "opacity-60"}>
              <Td><div className="font-medium">{p.name}</div><div className={note}>{p.client || "No client in Toggl"}{p.active ? "" : " · archived"}</div></Td>
              <Td right>{Math.round(p.hours)}h</Td>
              <Td>
                {p.job_id ? (
                  <Link href={`/app/jobs/${p.job_id}`} className="text-brand hover:underline">{p.job_label}</Link>
                ) : !p.active ? (
                  <Badge>Archived</Badge>
                ) : (
                  <form action={mapTogglProjectAction} className="flex flex-wrap gap-2">
                    <input type="hidden" name="connection_id" value={connId} />
                    <input type="hidden" name="project_id" value={p.external_id} />
                    <input type="hidden" name="client_name" value={p.client} />
                    <select name="company_id" className="field-sm min-w-40" aria-label={`Client for ${p.name}`} defaultValue={suggestClient(p.name, clients, p.client) ?? ""}>
                      <option value="">{p.client ? `New client: ${p.client}` : "Choose a client…"}</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <SubmitButton className={buttonClass("secondary", "sm")}>Create job</SubmitButton>
                  </form>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  );
}

/** Trello: pick which boards become jobs. */
export function TrelloPanel({ connId, boards, clients, jobs }: { connId: string; boards: Awaited<ReturnType<typeof trelloPanel>>; clients: Clients; jobs: { id: string; label: string }[] }) {
  return (
    <div className="space-y-3 border-t border-line pt-4">
      <h3 className="text-sm font-semibold">Boards</h3>
      <p className={note}>A board becomes a job waiting for its scope, and its open cards become tasks with their due dates, owners and status. Nothing is written back to Trello.</p>
      <Table head={["Board", "Cards", "Job in 8gency"]} empty={<Empty>No boards read yet. Click Sync now.</Empty>}>
        {boards.map((b) => (
          <tr key={b.external_id}>
            <Td className="font-medium">{b.name}</Td>
            <Td right>{b.cards}</Td>
            <Td>
              {b.job_id ? (
                <Link href={`/app/jobs/${b.job_id}?tab=tasks`} className="text-brand hover:underline">{b.job_label}</Link>
              ) : (
                <form action={mapTrelloBoardAction} className="grid gap-2 sm:grid-cols-2">
                  <input type="hidden" name="connection_id" value={connId} />
                  <input type="hidden" name="board_id" value={b.external_id} />
                  <input type="hidden" name="client_name" value={b.name} />
                  <Field label="Client">
                    <select name="company_id" className="field-sm" defaultValue={suggestClient(b.name, clients) ?? ""}>
                      <option value="">New client: {b.name}</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Job name"><input name="job_name" className="field-sm" defaultValue={b.name} /></Field>
                  <Field label="Or an existing job" className="sm:col-span-2">
                    <select name="job_id" className="field-sm" defaultValue="">
                      <option value="">Create a new job</option>
                      {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
                    </select>
                  </Field>
                  <div className="sm:col-span-2"><SubmitButton className={buttonClass("secondary", "sm")}>Map this board</SubmitButton></div>
                </form>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

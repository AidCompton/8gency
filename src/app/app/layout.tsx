import Link from "next/link";
import { Suspense } from "react";
import { logout } from "../auth-actions";
import { stopTimerAction } from "./_actions/time";
import { Flash } from "@/components/Flash";
import { NavLinks } from "@/components/NavLinks";
import { TimerClock } from "@/components/Timer";
import { requireUser, tenant } from "@/lib/auth";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { currentTimer } from "@/lib/services/time";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { timer, unread, triage } = await tenant(user, async (tx) => ({
    timer: await currentTimer(tx, user.id),
    unread: (await tx.one<{ n: number }>("select count(*)::int as n from notifications where user_id = $1 and read_at is null", [user.id]))!.n,
    triage: (await tx.one<{ n: number }>("select count(*)::int as n from client_requests where status = 'new'"))!.n,
  }));
  const nav = [
    { href: "/app", label: "Home", show: true },
    { href: "/app/my-day", label: "My Day", show: true },
    { href: "/app/jobs", label: "Jobs", show: true },
    { href: "/app/clients", label: "Clients", show: can(user, "seeAllJobs") },
    { href: "/app/scope", label: "Scope Guard", show: can(user, "triage"), badge: triage },
    { href: "/app/time", label: "Time", show: true },
    { href: "/app/retainers", label: "Retainers", show: can(user, "seeBudgetBurn") },
    { href: "/app/billing", label: "Billing", show: can(user, "billing") },
    { href: "/app/pulse", label: "Pulse", show: can(user, "seeMargins") },
    { href: "/app/settings", label: "Settings", show: can(user, "settings") },
    { href: "/app/audit", label: "Audit log", show: can(user, "audit") },
    { href: "/app/outbox", label: "Outbox", show: can(user, "settings") },
  ].filter((n) => n.show);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="no-print border-b border-line bg-surface lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-4 py-4 lg:block">
          <Link href="/app" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-lg text-sm text-white" style={{ background: user.agency_color }}>
              8
            </span>
            <span className="truncate">{user.agency_name}</span>
          </Link>
        </div>
        <NavLinks items={nav.map(({ href, label, badge }) => ({ href, label, badge }))} />
        <div className="hidden px-4 py-4 text-xs text-ink-3 lg:absolute lg:bottom-0 lg:block lg:w-[219px]">
          <div className="truncate font-medium text-ink-2">{user.name}</div>
          <div className="truncate">{ROLE_LABELS[user.role]} · {user.title}</div>
          <form action={logout}>
            <button className="mt-2 hover:text-ink">Log out</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="no-print sticky top-0 z-10 flex items-center justify-end gap-3 border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur sm:px-6">
          {timer && (
            <form action={stopTimerAction} className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-3 pr-1 text-sm">
              <span className="h-2 w-2 animate-pulse rounded-full bg-critical" aria-hidden />
              <span className="max-w-[40vw] truncate text-ink-2">
                {timer.job_number} {timer.task_title ? `· ${timer.task_title}` : ""}
              </span>
              <TimerClock startedAt={new Date(timer.started_at).toISOString()} />
              <button className="rounded-full bg-ink px-2.5 py-0.5 text-xs text-bg">Stop</button>
            </form>
          )}
          <Link href="/app/notifications" className="relative rounded-lg px-2 py-1 text-sm text-ink-2 hover:bg-surface-2" aria-label={`${unread} unread notifications`}>
            Inbox
            {unread > 0 && <span className="ml-1 rounded-full bg-brand px-1.5 py-0.5 text-xs text-brand-ink">{unread}</span>}
          </Link>
          <form action={logout} className="lg:hidden">
            <button className="text-sm text-ink-3">Log out</button>
          </form>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <Suspense>
            <Flash />
          </Suspense>
          {children}
        </main>
      </div>
    </div>
  );
}

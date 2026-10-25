import { cookies } from "next/headers";
import { touchPresence, unreadTotal } from "@/lib/services/chat";
import { Bell, Plugs, SignOut } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Suspense } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { logout } from "../auth-actions";
import { stopTimerAction } from "./_actions/time";
import { Flash } from "@/components/Flash";
import { NavLinks, type NavItem } from "@/components/NavLinks";
import { Avatar } from "@/components/ui";
import { TimerClock } from "@/components/Timer";
import { requireUser, tenant } from "@/lib/auth";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { currentTimer } from "@/lib/services/time";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const navCollapsed = (await cookies()).get("8g_nav")?.value === "collapsed";
  const { timer, unread, triage, chatUnread } = await tenant(user, async (tx) => ({
    timer: await currentTimer(tx, user.id),
    chatUnread: await unreadTotal(tx, user.id),
    _seen: await touchPresence(tx, user.id),
    unread: (await tx.one<{ n: number }>("select count(*)::int as n from notifications where user_id = $1 and read_at is null", [user.id]))!.n,
    triage: (await tx.one<{ n: number }>("select count(*)::int as n from client_requests where status = 'new'"))!.n,
  }));
  const nav: NavItem[] = (
    [
      { href: "/app", label: "Home", icon: "home", group: "", show: true },
      { href: "/app/my-day", label: "My Day", icon: "myday", group: "", show: true },
      { href: "/app/chat", label: "Chat", icon: "chat", group: "", show: true, badge: chatUnread },
      { href: "/app/jobs", label: "Jobs", icon: "jobs", group: "Workspace", show: true },
      { href: "/app/clients", label: "Clients", icon: "clients", group: "Workspace", show: can(user, "seeAllJobs") },
      { href: "/app/scope", label: "Scope Guard", icon: "scope", group: "Workspace", show: can(user, "triage"), badge: triage },
      { href: "/app/time", label: "Time", icon: "time", group: "Workspace", show: true },
      { href: "/app/bookings", label: "Book time", icon: "bookings", group: "Workspace", show: true },
      { href: "/app/team", label: "Team", icon: "team", group: "Workspace", show: can(user, "seeTeamTime") },
      { href: "/app/automations", label: "Automations", icon: "automations", group: "Workspace", show: can(user, "automations") },
      { href: "/app/retainers", label: "Retainers", icon: "retainers", group: "Money", show: can(user, "seeBudgetBurn") },
      { href: "/app/billing", label: "Billing", icon: "billing", group: "Money", show: can(user, "billing") },
      { href: "/app/pulse", label: "Pulse", icon: "pulse", group: "Money", show: can(user, "seeMargins") },
      { href: "/app/settings", label: "Settings", icon: "settings", group: "Admin", show: can(user, "settings") },
      { href: "/app/audit", label: "Audit log", icon: "audit", group: "Admin", show: can(user, "audit") },
      { href: "/app/outbox", label: "Outbox", icon: "outbox", group: "Admin", show: can(user, "settings") },
    ] as (NavItem & { show: boolean })[]
  )
    .filter((n) => n.show)
    .map(({ show: _show, ...n }) => n);

  return (
    <div
      id="app-shell"
      data-nav={navCollapsed ? "collapsed" : "open"}
      className="min-h-screen md:grid md:grid-cols-[240px_minmax(0,1fr)] md:transition-[grid-template-columns] md:duration-200 md:data-[nav=collapsed]:grid-cols-[64px_minmax(0,1fr)] print:block"
    >
      <aside className="no-print border-b border-line bg-surface md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-b-0 md:border-r">
        <NavLinks
          items={nav}
          initialCollapsed={navCollapsed}
          brandMark={
            <Link href="/app" aria-label={user.agency_name} title={user.agency_name} className="grid h-9 w-9 place-items-center rounded-lg text-sm font-bold text-white shadow-sm" style={{ background: user.agency_color }}>
              {user.agency_name.charAt(0).toUpperCase()}
            </Link>
          }
          accountMark={
            <div className="flex flex-col items-center gap-1.5">
              <Link href="/app/account" title={`${user.name} · ${ROLE_LABELS[user.role]} · your account`}>
                <Avatar name={user.name} />
              </Link>
              <form action={logout}>
                <SubmitButton aria-label="Log out" title="Log out" className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink">
                  <SignOut aria-hidden size={18} />
                </SubmitButton>
              </form>
            </div>
          }
          brand={
            <Link href="/app" className="flex min-w-0 items-center gap-2.5 rounded-lg">
              {user.agency_logo_v ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/logo?v=${user.agency_logo_v}`} alt={user.agency_name} className="logo-chip max-h-9 max-w-[176px] object-contain object-left" />
              ) : (
                <>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-bold text-white shadow-sm" style={{ background: user.agency_color }} aria-hidden>
                    {user.agency_name.charAt(0).toUpperCase()}
                  </span>
                  <span className="truncate font-semibold tracking-tight">{user.agency_name}</span>
                </>
              )}
            </Link>
          }
          account={
            <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
              <Link href="/app/account" title="Your account" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg transition-colors hover:bg-surface-2">
                <Avatar name={user.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{user.name}</div>
                  <div className="truncate text-xs text-ink-3">{ROLE_LABELS[user.role]}</div>
                </div>
              </Link>
              <form action={logout}>
                <SubmitButton aria-label="Log out" title="Log out" className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11">
                  <SignOut aria-hidden size={18} />
                </SubmitButton>
              </form>
            </div>
          }
        />
      </aside>
      <div className="min-w-0">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur-md sm:px-6 md:h-16">
          <div className="hidden text-sm text-ink-3 sm:block">{new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: user.timezone })}</div>
          <div className="ml-auto flex items-center gap-2">
            {timer && (
              <form action={stopTimerAction} className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-3 pr-1 text-sm shadow-xs">
                <span className="relative flex h-2 w-2" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-critical opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-critical" />
                </span>
                <span className="max-w-[36vw] truncate text-ink-2">
                  {timer.job_number} {timer.task_title ? `· ${timer.task_title}` : ""}
                </span>
                <span className="font-medium text-ink"><TimerClock startedAt={new Date(timer.started_at).toISOString()} /></span>
                <SubmitButton className="min-h-7 rounded-full bg-ink px-3 text-xs font-medium text-bg transition-opacity hover:opacity-85 pointer-coarse:min-h-11">Stop</SubmitButton>
              </form>
            )}
            <Link
              href="/app/connectors"
              aria-label="Connectors"
              title="Connectors"
              className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
            >
              <Plugs aria-hidden size={20} />
            </Link>
            <Link
              href="/app/notifications"
              aria-label={unread ? `Inbox, ${unread} unread` : "Inbox"}
              title="Inbox"
              className="relative grid h-9 w-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
            >
              <Bell aria-hidden size={20} />
              {unread > 0 && (
                <span aria-hidden className="tnum absolute right-0.5 top-0.5 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] font-semibold leading-4 text-brand-ink ring-2 ring-bg">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">
          <Suspense>
            <Flash />
          </Suspense>
          {children}
        </main>
      </div>
    </div>
  );
}

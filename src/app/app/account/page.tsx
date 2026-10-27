import { Bell, PaintBrush, ShieldCheck, UserCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AutoForm } from "@/components/AutoForm";
import { SubmitButton } from "@/components/SubmitButton";
import { ThemePicker, type Theme } from "@/components/ThemeToggle";
import { Badge, buttonClass, cx } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { adminQuery } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/permissions";
import { setEmailPrefsAction, signOutOthersAction, updateProfileAction } from "../_actions/account";

export const metadata = { title: "Your account" };

const TABS = [
  { key: "profile", label: "Profile", icon: UserCircle },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "appearance", label: "Appearance", icon: PaintBrush },
  { key: "security", label: "Security", icon: ShieldCheck },
] as const;

/** A settings row: what it is on the left, the control on the right. */
function Row({ title, hint, children, stack }: { title: string; hint?: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={cx("gap-x-8 gap-y-3 border-b border-line py-5 last:border-b-0", stack ? "grid" : "grid sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center")}>
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        {hint && <div className="mt-0.5 max-w-xl text-sm text-ink-3">{hint}</div>}
      </div>
      {children && <div className="min-w-0">{children}</div>}
    </div>
  );
}

function Switch({ name, label, hint, on }: { name: string; label: string; hint: string; on: boolean }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-6 border-b border-line py-5 text-base text-ink last:border-b-0">
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="mt-0.5 block max-w-xl text-sm font-normal text-ink-3">{hint}</span>
      </span>
      <input type="checkbox" role="switch" name={name} defaultChecked={on} />
    </label>
  );
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "profile";
  const user = await requireUser();
  const [prefs] = await adminQuery<{ chat_nudges: boolean; timesheet_reminders: boolean; weekly_email: boolean }>("select chat_nudges, timesheet_reminders, weekly_email from users where id = $1", [user.id]);
  const saved = (await cookies()).get("8g_theme")?.value;
  const theme: Theme = saved === "light" || saved === "dark" ? saved : "system";
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8 flex flex-wrap items-center gap-5">
        <span aria-hidden className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-brand text-xl font-semibold text-brand-ink shadow-sm">{initials}</span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{user.name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-3">
            <span className="truncate">{user.email}</span>
            <Badge tone="brand">{ROLE_LABELS[user.role]}</Badge>
            <span>{user.agency_name}</span>
          </p>
        </div>
      </header>

      <div className="grid gap-8 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Account sections" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/app/account?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={cx("flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors pointer-coarse:py-3", tab === t.key ? "bg-brand/10 text-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
            >
              <t.icon aria-hidden size={18} weight={tab === t.key ? "fill" : "regular"} /> {t.label}
            </Link>
          ))}
        </nav>

        <section className="min-w-0 rounded-2xl border border-line bg-surface px-6 shadow-sm">
          {tab === "profile" && (
            <>
              <div className="border-b border-line py-5">
                <h2 className="text-lg font-semibold tracking-tight">Profile</h2>
                <p className="mt-0.5 text-sm text-ink-3">How you appear to your team.</p>
              </div>
              <Row title="Name" hint="Shown on chat, tasks and time entries.">
                <form action={updateProfileAction} className="flex gap-2">
                  <input name="name" defaultValue={user.name} required minLength={2} maxLength={80} aria-label="Your name" autoComplete="name" />
                  <SubmitButton className={buttonClass("secondary")}>Save</SubmitButton>
                </form>
              </Row>
              <Row title="Email" hint="You sign in with this. Ask your agency owner to change it.">
                <input value={user.email} readOnly aria-label="Email" />
              </Row>
              <Row title="Role" hint="Decides what you can see and do. Set by your agency owner.">
                <input value={ROLE_LABELS[user.role]} readOnly aria-label="Role" />
              </Row>
              <Row title="Agency">
                <input value={user.agency_name} readOnly aria-label="Agency" />
              </Row>
            </>
          )}

          {tab === "notifications" && (
            <>
              <div className="border-b border-line py-5">
                <h2 className="text-lg font-semibold tracking-tight">Notifications</h2>
                <p className="mt-0.5 text-sm text-ink-3">Emails from 8gency. Changes save as you go.</p>
              </div>
              <AutoForm action={setEmailPrefsAction}>
                <Switch name="chat_nudges" on={prefs.chat_nudges} label="Unread chat messages" hint="One email, ten minutes after someone mentions or messages you, only if you haven't seen it." />
                <Switch name="timesheet_reminders" on={prefs.timesheet_reminders} label="Friday timesheet reminder" hint="One email on Friday afternoon, only if a weekday this week has no time logged." />
                {user.role === "owner" && <Switch name="weekly_email" on={prefs.weekly_email} label="Your week, every Monday" hint="What was billed and collected, what is still leaking, and the three biggest fixes." />}
              </AutoForm>
            </>
          )}

          {tab === "appearance" && (
            <>
              <div className="border-b border-line py-5">
                <h2 className="text-lg font-semibold tracking-tight">Appearance</h2>
                <p className="mt-0.5 text-sm text-ink-3">Pick how 8gency looks on this device. You can also flip it any time from the sun or moon at the top right.</p>
              </div>
              <div className="py-5"><ThemePicker initial={theme} /></div>
            </>
          )}

          {tab === "security" && (
            <>
              <div className="border-b border-line py-5">
                <h2 className="text-lg font-semibold tracking-tight">Security</h2>
                <p className="mt-0.5 text-sm text-ink-3">Where you're signed in.</p>
              </div>
              <Row title="Sign out other devices" hint="Lost a laptop, or used a shared computer? This signs you out everywhere except here.">
                <form action={signOutOthersAction}>
                  <SubmitButton confirm="Sign out of every other device?" className={buttonClass("secondary")}>Sign out other devices</SubmitButton>
                </form>
              </Row>
              <Row title="Password" hint="If you forget it, choose “Forgot password” on the sign-in page and we'll email you a link." />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

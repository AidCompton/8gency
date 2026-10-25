import { Avatar, Card, Field, PageHeader, buttonClass } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { changePasswordAction, setChatNudgesAction, signOutOthersAction } from "../_actions/account";
import { adminQuery } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/permissions";

export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const user = await requireUser();
  const [{ chat_nudges }] = await adminQuery<{ chat_nudges: boolean }>("select chat_nudges from users where id = $1", [user.id]);
  return (
    <>
      <PageHeader title="Your account" subtitle="Your sign-in details and where you're signed in." />
      <div className="grid max-w-4xl items-start gap-4 lg:grid-cols-2">
        <Card title="You">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} />
            <div className="min-w-0">
              <div className="font-medium">{user.name}</div>
              <div className="truncate text-sm text-ink-3">{user.email}</div>
              <div className="text-xs text-ink-3">{ROLE_LABELS[user.role]} · {user.agency_name}</div>
            </div>
          </div>
          <form action={signOutOthersAction} className="mt-5 border-t border-line pt-4">
            <p className="mb-3 text-sm text-ink-2">Lost a laptop, or used a shared computer? Sign out everywhere except here.</p>
            <SubmitButton confirm="Sign out of every other device?" className={buttonClass("secondary", "sm")}>Sign out other devices</SubmitButton>
          </form>
        </Card>
        <Card title="Emails from 8gency">
          <form action={setChatNudgesAction} className="space-y-3">
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" name="chat_nudges" defaultChecked={chat_nudges} className="mt-0.5" />
              <span><span className="block font-medium">Email me about chat messages I haven't read</span><span className="block text-xs text-ink-3">One email, ten minutes after someone mentions or messages you, only if you haven't seen it. Never about anything else.</span></span>
            </label>
            <SubmitButton className={buttonClass("secondary", "sm")}>Save</SubmitButton>
          </form>
        </Card>
        <Card title="Change your password">
          <form action={changePasswordAction} className="space-y-3">
            <Field label="Current password"><input name="current" type="password" autoComplete="current-password" required /></Field>
            <Field label="New password" hint="At least 10 characters. A few unrelated words works well."><input name="next" type="password" minLength={10} autoComplete="new-password" required /></Field>
            <Field label="Type the new one again"><input name="confirm" type="password" minLength={10} autoComplete="new-password" required /></Field>
            <SubmitButton className={buttonClass("primary", "sm")}>Change password</SubmitButton>
            <p className="text-xs text-ink-3">Changing it signs out every other device.</p>
          </form>
        </Card>
      </div>
    </>
  );
}

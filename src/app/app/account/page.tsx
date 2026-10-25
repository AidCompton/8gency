import { Avatar, Card, Field, PageHeader, buttonClass } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { changePasswordAction, signOutOthersAction } from "../_actions/account";
import { requireUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/permissions";

export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const user = await requireUser();
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

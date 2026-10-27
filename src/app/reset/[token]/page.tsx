import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { resetPasswordAction } from "../../auth-actions";
import { AuthShell } from "@/components/AuthShell";
import { Field, buttonClass } from "@/components/ui";
import { resetTokenValid } from "@/lib/services/accountAuth";

export const metadata = { title: "Choose a new password" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const footer = <Link className="text-brand hover:underline" href="/login">Back to log in</Link>;
  if (!(await resetTokenValid(token))) {
    return (
      <AuthShell title="That link has expired" subtitle="Reset links work once, for an hour." footer={footer}>
        <Link href="/forgot" className={buttonClass("primary") + " w-full"}>Get a new link</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Choose a new password" subtitle="You'll be signed out everywhere else." footer={footer}>
      <form action={resetPasswordAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <Field label="New password" hint="At least 10 characters. A few unrelated words works well."><input name="password" type="password" minLength={10} autoComplete="new-password" required /></Field>
        <Field label="Type it again"><input name="confirm" type="password" minLength={10} autoComplete="new-password" required /></Field>
        <SubmitButton className={buttonClass("primary") + " w-full"}>Save password</SubmitButton>
      </form>
    </AuthShell>
  );
}

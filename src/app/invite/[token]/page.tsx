import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { acceptInviteAction } from "../../auth-actions";
import { AuthShell } from "@/components/AuthShell";
import { Field, buttonClass } from "@/components/ui";
import { firstName } from "@/lib/domain/text";
import { staffInviteInfo } from "@/lib/services/accountAuth";

export const metadata = { title: "Join your team" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await staffInviteInfo(token);
  const footer = <>Already have an account? <Link className="text-brand hover:underline" href="/login">Log in</Link></>;
  if (!info) {
    return (
      <AuthShell title="That invitation has expired" subtitle="Invitations work once, for 7 days. Ask whoever invited you to send a new one." footer={footer}>
        <Link href="/login" className={buttonClass("secondary") + " w-full"}>Go to log in</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={`Welcome, ${firstName(info.name)}`} subtitle={`Set a password to join ${info.agency}.`} footer={footer}>
      <form action={acceptInviteAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <Field label="Your email"><input type="email" value={info.email} readOnly /></Field>
        <Field label="Choose a password" hint="At least 10 characters. A few unrelated words works well."><input name="password" type="password" minLength={10} autoComplete="new-password" required /></Field>
        <SubmitButton className={buttonClass("primary") + " w-full"}>Join {info.agency}</SubmitButton>
      </form>
    </AuthShell>
  );
}

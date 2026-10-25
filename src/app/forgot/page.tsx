import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { forgotPasswordAction } from "../auth-actions";
import { AuthShell } from "@/components/AuthShell";
import { Field, buttonClass } from "@/components/ui";

export const metadata = { title: "Reset your password" };

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const sent = (await searchParams).sent;
  const footer = <Link className="text-brand hover:underline" href="/login">Back to log in</Link>;
  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle="If that address has an account, a reset link is on its way. It works for one hour." footer={footer}>
        <p className="text-sm text-ink-2">Nothing yet? Check your spam folder, or try again in a few minutes.</p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Reset your password" subtitle="Enter your work email and we'll send you a link." footer={footer}>
      <form action={forgotPasswordAction} className="space-y-4">
        <Field label="Email"><input name="email" type="email" autoComplete="email" required /></Field>
        <SubmitButton className={buttonClass("primary") + " w-full"}>Send reset link</SubmitButton>
      </form>
    </AuthShell>
  );
}

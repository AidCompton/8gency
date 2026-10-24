import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { login } from "../auth-actions";
import { AuthShell } from "@/components/AuthShell";
import { Field, buttonClass } from "@/components/ui";

export const metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <AuthShell title="Welcome back" subtitle="Log in to your agency workspace." footer={<>New agency? <Link className="text-brand hover:underline" href="/signup">Start free</Link></>}>
      <form action={login} className="space-y-4">
        <Field label="Email">
          <input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password">
          <input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className={buttonClass("primary") + " w-full"}>Log in</SubmitButton>
      </form>
      {process.env.NODE_ENV !== "production" && (
        <p className="mt-5 rounded-lg border border-line bg-surface-2/60 p-3 text-xs leading-relaxed text-ink-2">
          Demo: <b>owner@sundaystudio.example</b> / <b>demo1234</b>. Other roles: ops@, finance@, sipho@ (account), jess@ (PM), mia@ (designer).
        </p>
      )}
    </AuthShell>
  );
}

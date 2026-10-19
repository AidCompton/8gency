import Link from "next/link";
import { login } from "../auth-actions";
import { AuthShell } from "@/components/AuthShell";
import { Field, buttonClass } from "@/components/ui";

export const metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <AuthShell title="Log in to 8gency" footer={<>New agency? <Link className="text-brand hover:underline" href="/signup">Start free</Link></>}>
      <form action={login} className="space-y-4">
        <Field label="Email">
          <input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password">
          <input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <button className={buttonClass("primary") + " w-full"}>Log in</button>
      </form>
      {process.env.NODE_ENV !== "production" && (
        <p className="mt-4 rounded-lg bg-surface-2 p-3 text-xs text-ink-2">
          Demo: <b>owner@sundaystudio.example</b> / <b>demo1234</b>. Other roles: ops@, finance@, sipho@ (account), jess@ (PM), mia@ (designer).
        </p>
      )}
    </AuthShell>
  );
}

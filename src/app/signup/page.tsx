import Link from "next/link";
import { signup } from "../auth-actions";
import { AuthShell } from "@/components/AuthShell";
import { Field, buttonClass } from "@/components/ui";
import { AGENCY_TYPES } from "@/lib/templates";

export const metadata = { title: "Start free" };

export default function SignupPage() {
  return (
    <AuthShell title="Set up your agency" footer={<>Already on 8gency? <Link className="text-brand hover:underline" href="/login">Log in</Link></>}>
      <form action={signup} className="space-y-4">
        <Field label="Agency name">
          <input name="agencyName" required />
        </Field>
        <Field label="Agency type" hint="Loads job templates, rate card and onboarding checklists. You can change everything later.">
          <select name="agencyType" defaultValue="full_service">
            {AGENCY_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Your name">
          <input name="ownerName" required />
        </Field>
        <Field label="Work email">
          <input name="email" type="email" required />
        </Field>
        <Field label="Password">
          <input name="password" type="password" minLength={8} required />
        </Field>
        <button className={buttonClass("primary") + " w-full"}>Create agency</button>
        <p className="text-xs text-ink-3">South African VAT (15%) is preset. Confirm tax settings with your accountant.</p>
      </form>
    </AuthShell>
  );
}

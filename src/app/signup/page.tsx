import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { signup } from "../auth-actions";
import { AuthShell } from "@/components/AuthShell";
import { Field, buttonClass } from "@/components/ui";
import { agencyInviteInfo } from "@/lib/services/accountAuth";
import { AGENCY_TYPES } from "@/lib/templates";

export const metadata = { title: "Set up your agency" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const invite = (await searchParams).invite ?? "";
  const info = invite ? await agencyInviteInfo(invite) : null;
  const footer = <>Already on 8gency? <Link className="text-brand hover:underline" href="/login">Log in</Link></>;

  if (!info) {
    return (
      <AuthShell title="8gency is invite-only for now" subtitle={invite ? "That invitation has expired or was already used." : "We're onboarding agencies a few at a time."} footer={footer}>
        <p className="text-sm text-ink-2">Join the waitlist and tell us which tools you use. We invite agencies in order, and the tools people ask for decide what we connect next.</p>
        <Link href="/waitlist" className={buttonClass("primary") + " mt-5 w-full"}>Join the waitlist</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Set up your agency" subtitle="You're invited. Your Agency Health Scan is ready as soon as your data is in." footer={footer}>
      <form action={signup} className="space-y-4">
        <input type="hidden" name="invite" value={invite} />
        <Field label="Work email" hint="The address your invitation was sent to.">
          <input type="email" value={info.email} readOnly />
        </Field>
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
          <input name="ownerName" defaultValue={info.name} required />
        </Field>
        <Field label="Password" hint="At least 10 characters. A few unrelated words works well.">
          <input name="password" type="password" minLength={10} autoComplete="new-password" required />
        </Field>
        <SubmitButton className={buttonClass("primary") + " w-full"}>Create agency</SubmitButton>
        <p className="text-xs text-ink-3">South African VAT (15%) is preset. Confirm tax settings with your accountant.</p>
      </form>
    </AuthShell>
  );
}

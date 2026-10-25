import { CheckCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { joinWaitlistAction } from "../auth-actions";
import { AuthShell } from "@/components/AuthShell";
import { Field, buttonClass } from "@/components/ui";

export const metadata = { title: "Join the waitlist" };

const TOOLS = {
  time: ["Toggl", "Harvest", "Clockify", "A spreadsheet", "We don't track time"],
  projects: ["Trello", "Asana", "Monday", "ClickUp", "Notion", "A spreadsheet"],
  accounting: ["Xero", "QuickBooks", "Sage", "Zoho Books", "Excel or Word", "Our accountant does it"],
  mail: ["Google Workspace", "Microsoft 365", "Gmail (free)", "Hosting-provider email"],
};

function Pick({ label, name, options }: { label: string; name: string; options: string[] }) {
  return (
    <Field label={label}>
      <input name={name} list={`l-${name}`} placeholder="Pick or type" maxLength={80} />
      <datalist id={`l-${name}`}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </Field>
  );
}

export default async function WaitlistPage({ searchParams }: { searchParams: Promise<{ joined?: string }> }) {
  const joined = (await searchParams).joined;
  const footer = <>Already invited? <Link className="text-brand hover:underline" href="/login">Log in</Link></>;
  if (joined) {
    return (
      <AuthShell title="You're on the list" subtitle="Thank you. We'll email you when your spot is ready." footer={footer}>
        <p className="flex items-start gap-2 text-sm text-ink-2"><CheckCircle aria-hidden size={18} weight="fill" className="mt-0.5 shrink-0 text-good-ink" /> The tools you told us about decide which connections we build first, so you'll be among the first to hear when yours is ready.</p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Join the waitlist" subtitle="See where your agency is winning, where it's losing, and patch the holes before they sink you." footer={footer}>
      <form action={joinWaitlistAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name"><input name="name" required autoComplete="name" /></Field>
          <Field label="Agency name"><input name="agencyName" required autoComplete="organization" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Work email"><input name="email" type="email" required autoComplete="email" /></Field>
          <Field label="People in your team"><input name="teamSize" inputMode="numeric" placeholder="e.g. 5" /></Field>
        </div>
        <fieldset className="space-y-3 rounded-lg border border-line p-3">
          <legend className="px-1 text-[13px] font-medium text-ink-2">What do you use today?</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Pick label="Tracking time" name="time" options={TOOLS.time} />
            <Pick label="Managing projects" name="projects" options={TOOLS.projects} />
            <Pick label="Invoicing and accounts" name="accounting" options={TOOLS.accounting} />
            <Pick label="Email and calendar" name="mail" options={TOOLS.mail} />
          </div>
        </fieldset>
        {/* Real people never see or fill this in; bots do. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <SubmitButton className={buttonClass("primary") + " w-full"}>Join the waitlist</SubmitButton>
        <p className="text-xs text-ink-3">We use your details only to invite you and to decide what to build. See our privacy policy once it's published. We never share them.</p>
      </form>
    </AuthShell>
  );
}

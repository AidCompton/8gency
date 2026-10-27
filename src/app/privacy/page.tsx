import { Prose, SiteShell } from "@/components/SiteShell";
import { SITE } from "@/lib/site";

export const metadata = { title: "Privacy policy", description: "What 8gency collects, why, who it is shared with, how it is protected and your rights under POPIA." };

export default function PrivacyPage() {
  return (
    <SiteShell>
      <Prose title="Privacy policy" updated={SITE.legalUpdated} draft>
        <p>8gency is software that marketing agencies use to run their work: scope, time, billing, chat and profit. This policy explains what personal information we handle, why, who sees it, how we protect it, and what you can ask of us. It follows South Africa&apos;s Protection of Personal Information Act (POPIA).</p>

        <h2>1. Who we are, and our two roles</h2>
        <p><strong>{SITE.legalName}</strong>{SITE.registration && <>, registration number {SITE.registration}</>}{SITE.address && <>, {SITE.address}</>}. Contact: <a href={`mailto:${SITE.email.privacy}`}>{SITE.email.privacy}</a>.{SITE.infoOfficer && <> Information Officer: {SITE.infoOfficer}.</>}</p>
        <p>We act in two roles:</p>
        <ul>
          <li><strong>As the operator for your agency.</strong> Everything an agency puts into 8gency (its staff, its clients&apos; contacts, jobs, time, invoices, chat and files) belongs to that agency, which is the &ldquo;responsible party&rdquo;. We process it only on the agency&apos;s instructions, under an operator agreement we sign with each agency.</li>
          <li><strong>As the responsible party for our own relationship with you.</strong> That covers the people who sign in, the people on our waitlist, and counts of how the product is used.</li>
        </ul>
        <p>If you are a client of an agency that uses 8gency, or a member of its staff, and you want to see, correct or delete something about you, ask that agency first. We will help it respond.</p>

        <h2>2. What we collect</h2>
        <table>
          <thead><tr><th>Who</th><th>What</th><th>Why</th></tr></thead>
          <tbody>
            <tr><td>People who sign in</td><td>Name, work email, role, a password stored as a one-way hash, the devices you are signed in on (as hashed tokens), and sign-in attempts with your email and IP address.</td><td>To let you in, keep your account secure and limit attacks.</td></tr>
            <tr><td>Waitlist</td><td>Name, agency, work email, team size and the tools you use.</td><td>To invite you, and to decide which integrations to build first. If you came through another agency&apos;s referral link, that agency can see your agency&apos;s name and whether you joined, so it can earn its reward.</td></tr>
            <tr><td>Agency data (we are the operator)</td><td>What the agency enters or connects: staff, client contacts, jobs, tasks, time entries, invoices and payments, retainers, files, chat messages, and tokens that connect its Gmail, Outlook, Xero, Toggl, Trello and similar accounts.</td><td>To provide the service the agency has signed up for.</td></tr>
            <tr><td>Everyone using the product</td><td>Counts of features used and when (no content), and a short audit trail of actions within an agency.</td><td>To run and improve the product, and to give agencies a record of who did what.</td></tr>
          </tbody>
        </table>
        <p>We do not sell personal information. We do not use it for advertising. We do not read what is inside an agency&apos;s account. If an agency asks us for support and agrees to it, we may look at a specific part of its account for a limited time, and we record that we did.</p>

        <h2>3. Who else handles it</h2>
        <p>We use a small number of other companies to run the service. Each handles information only to do that job.</p>
        <table>
          <thead><tr><th>Provider</th><th>For</th><th>Where</th></tr></thead>
          <tbody>
            <tr><td>Our hosting provider (to be named when hosting goes live)</td><td>Running the application, database and file storage</td><td>South Africa</td></tr>
            <tr><td>Resend</td><td>Sending account email: sign-in help, invitations, weekly summaries and reminders</td><td>Outside South Africa</td></tr>
            <tr><td>Anthropic</td><td>Drafting a job scope, only for agencies that switch AI on. The text the agency chooses to send is processed to produce a draft, and a person always reviews it.</td><td>Outside South Africa</td></tr>
            <tr><td>The apps an agency connects (Google, Microsoft, Xero, Toggl, Trello and others)</td><td>Reading and sending on the agency&apos;s behalf, using the access the agency grants</td><td>As each provider operates</td></tr>
          </tbody>
        </table>
        <p>Email that agencies send to their clients goes out from the agency&apos;s own address through its own Google or Microsoft account. It does not pass through a 8gency mailbox.</p>
        <p>Where information leaves South Africa (account email and optional AI drafting), we rely on the provider being subject to rules that protect personal information in a similar way, or on your consent, as POPIA allows.</p>

        <h2>4. Google and Microsoft data</h2>
        <p>When an agency connects Gmail, Google Calendar, Outlook or similar, we use the access only to do what the agency asked: send the email it composes, read calendar events to suggest time entries, and so on. 8gency&apos;s use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. We do not use that information for advertising, we do not sell it, and no person at 8gency reads it except with the agency&apos;s permission for support, or where the law requires it. Access can be removed at any time from the Connectors page or from your Google or Microsoft account, and the stored tokens are then deleted.</p>

        <h2>5. How long we keep it</h2>
        <ul>
          <li><strong>Agency data:</strong> for as long as the agency uses 8gency. After the agency leaves, we export it on request within 5 working days and delete it within 30 days, and confirm in writing. Backups roll off on their normal cycle.</li>
          <li><strong>Sign-in attempts:</strong> pruned regularly; they exist only to limit attacks.</li>
          <li><strong>Waitlist details:</strong> until you are invited, or you ask us to remove them.</li>
          <li><strong>Unsent chat uploads and idempotency records:</strong> a day or two.</li>
        </ul>

        <h2>6. How we protect it</h2>
        <ul>
          <li>Every agency&apos;s data is separated from every other&apos;s inside the database itself, not only in the application.</li>
          <li>Connection tokens and API keys are encrypted at rest. Passwords are stored as one-way hashes.</li>
          <li>Sign-in is rate-limited and locks after repeated failures. Links sent to clients expire after 60 days unused and can be revoked at once.</li>
          <li>Connections are encrypted in transit. We keep automatic backups and test restoring them.</li>
          <li>Access to the production system is limited to the people who need it.</li>
        </ul>
        <p>If we discover that personal information has been accessed without authority, we will tell the affected agency promptly and help it notify the Information Regulator and the people concerned, as POPIA requires.</p>

        <h2>7. Cookies</h2>
        <p>We use a handful of small cookies that the service needs to work: your sign-in session, your light or dark choice, whether the menu is minimised, and a short-lived one that stops a button press being processed twice. We do not use advertising or tracking cookies, and we do not load third-party trackers.</p>

        <h2>8. Your rights</h2>
        <p>Under POPIA you may ask whether we hold information about you, ask for a copy, ask us to correct or delete it, object to how it is used, and withdraw consent where we rely on it. Email <a href={`mailto:${SITE.email.privacy}`}>{SITE.email.privacy}</a>. We reply within a reasonable time and tell you if we have to refer you to an agency that is the responsible party for the information.</p>
        <p>If you are unhappy with how we have handled your information, you may complain to the Information Regulator (South Africa) at <a href="https://inforegulator.org.za">inforegulator.org.za</a>.</p>

        <h2>9. Children</h2>
        <p>8gency is for businesses. It is not meant for anyone under 18 and we do not knowingly collect information from children.</p>

        <h2>10. Changes</h2>
        <p>If we change this policy in a way that matters, we will update the date above and tell agencies by email before the change takes effect.</p>
      </Prose>
    </SiteShell>
  );
}

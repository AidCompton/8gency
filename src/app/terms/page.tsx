import { Prose, SiteShell } from "@/components/SiteShell";
import { SITE } from "@/lib/site";

export const metadata = { title: "Terms of service", description: "The terms on which agencies use 8gency." };

export default function TermsPage() {
  return (
    <SiteShell>
      <Prose title="Terms of service" updated={SITE.legalUpdated} draft>
        <p>These terms are between <strong>{SITE.legalName}</strong> (&ldquo;8gency&rdquo;, &ldquo;we&rdquo;) and the business that signs up (&ldquo;the agency&rdquo;, &ldquo;you&rdquo;). By using 8gency you agree to them on behalf of the agency, and confirm that you are allowed to do so.</p>

        <h2>1. The service</h2>
        <p>8gency is software, delivered over the internet, that helps marketing agencies manage scope, time, billing, chat and profit. We may improve or change it over time. We will tell you before we remove something you rely on.</p>

        <h2>2. Accounts and access</h2>
        <ul>
          <li>Sign-up is by invitation. The person who creates the agency account is its owner and decides who else gets access and with what role.</li>
          <li>Each person signs in with their own account. Do not share passwords. You are responsible for what happens under your accounts, and must tell us promptly if you think one has been compromised.</li>
          <li>A &ldquo;seat&rdquo; is any person with an account. Your clients who use approval links are not seats.</li>
        </ul>

        <h2>3. Your data</h2>
        <p>What you put into 8gency stays yours. You give us permission to process it so that we can provide the service, as described in our <a href="/privacy">privacy policy</a> and the operator agreement we sign with you. You promise that you have the right to put it there, including your clients&apos; and staff members&apos; personal information.</p>
        <p>You can export your data (as CSV) whenever you ask, and we will deliver it within 5 working days. When you leave, we delete it within 30 days and confirm in writing.</p>

        <h2>4. Acceptable use</h2>
        <p>Do not use 8gency to break the law, to send spam or unlawful messages, to attack or probe the service or other customers, to upload malware, or to reverse-engineer it. We may suspend an account that does, after telling you where we can.</p>

        <h2>5. Connected apps</h2>
        <p>When you connect Gmail, Outlook, Xero, Toggl, Trello or another service, you authorise 8gency to act in it as you have allowed. Those services have their own terms, which you remain bound by. Email to your clients is sent from your own address through your own account.</p>

        <h2>6. Price and payment</h2>
        <ul>
          <li>Prices are per seat per month, in rand, and exclude VAT. We will tell you the price before you start paying, and any founding or pilot offer is set out in writing for your agency.</li>
          <li>If a payment is missed we will remind you. After a 14-day grace period the account becomes read-only. We never delete your data because of a missed payment, and the account returns to normal when you catch up.</li>
          <li>We will give at least 60 days&apos; written notice of a price change, and a price we have locked for a period holds for that period.</li>
        </ul>

        <h2>7. Availability and support</h2>
        <p>We aim for 8gency to be available and we keep backups, but we do not promise it will never be interrupted or error-free. We reply to support requests on the same business day, and tell affected agencies within an hour if there is an outage we know about. Pilot and early-access versions may contain bugs; they are provided to be tried alongside your existing tools.</p>

        <h2>8. Our responsibility</h2>
        <p>To the extent the law allows, we are not liable for lost profit, lost revenue or indirect loss, and our total liability for anything arising from the service in any 12-month period is limited to the amount you paid us for it in that period. Nothing in these terms limits liability that the law does not allow to be limited. The figures 8gency shows are tools to help you decide; you remain responsible for your invoices, tax and business decisions.</p>

        <h2>9. Ending the agreement</h2>
        <p>Either of us may end it with 30 days&apos; written notice. We may end it sooner if you seriously breach these terms and do not fix it after we ask. When it ends, section 3 applies to your data.</p>

        <h2>10. General</h2>
        <ul>
          <li>These terms are governed by the laws of South Africa, and its courts have jurisdiction.</li>
          <li>We may update these terms. We will tell you at least 30 days before a material change takes effect.</li>
          <li>Together with the operator agreement and any written offer for your agency, this is the whole agreement between us on the service.</li>
        </ul>
        <p>Questions: <a href={`mailto:${SITE.email.hello}`}>{SITE.email.hello}</a>.</p>
      </Prose>
    </SiteShell>
  );
}

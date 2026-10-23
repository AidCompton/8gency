import {
  ArrowsClockwise, Calculator, CalendarBlank, ChartBar, CheckCircle, CreditCard, DropboxLogo, EnvelopeSimple, FigmaLogo, GoogleDriveLogo, GoogleLogo, Handshake,
  Lightning, LinkedinLogo, MegaphoneSimple, MetaLogo, MicrosoftOutlookLogo, MicrosoftTeamsLogo, PaintBrush, Plugs, Plus, ShieldCheck, SlackLogo, TiktokLogo,
  VideoCamera, WebhooksLogo, WhatsappLogo,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Stagger } from "@/components/Motion";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, PageHeader, buttonClass, cx } from "@/components/ui";
import { toggleConnectorRequestAction } from "../_actions/connectors";
import { requireUser, tenant } from "@/lib/auth";
import { CONNECTORS, PHASES, type ConnectorDef, type ConnectorIcon } from "@/lib/domain/connectors";

export const metadata = { title: "Connectors" };

const ICONS: Record<ConnectorIcon, typeof GoogleLogo> = {
  gmail: GoogleLogo, calendar: CalendarBlank, outlook: MicrosoftOutlookLogo, slack: SlackLogo, whatsapp: WhatsappLogo, teams: MicrosoftTeamsLogo,
  drive: GoogleDriveLogo, dropbox: DropboxLogo, figma: FigmaLogo, canva: PaintBrush, meta: MetaLogo, google_ads: MegaphoneSimple, linkedin: LinkedinLogo,
  analytics: ChartBar, tiktok: TiktokLogo, hubspot: Handshake, mailchimp: EnvelopeSimple, klaviyo: EnvelopeSimple, xero: Calculator, quickbooks: Calculator,
  sage: Calculator, payments: CreditCard, zoom: VideoCamera, webhooks: WebhooksLogo, zapier: Lightning,
};

const CATEGORIES = [...new Set(CONNECTORS.map((c) => c.category))];

function ConnectorCard({ c, requested }: { c: ConnectorDef; requested: boolean }) {
  const Icon = ICONS[c.icon];
  return (
    <li id={c.key} data-stagger className="flex scroll-mt-24 flex-col rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-surface-2/60 text-ink">
          <Icon aria-hidden size={22} weight="duotone" />
        </span>
        <Badge tone={c.phase === 1 ? "brand" : c.phase === 2 ? "info" : "neutral"} dot>
          {PHASES[c.phase].label}
        </Badge>
      </div>
      <h3 className="mt-3 font-semibold">{c.name}</h3>
      <p className="mt-1 text-sm text-ink-2">{c.summary}</p>
      <ul className="mt-3 flex-1 space-y-1.5 text-sm text-ink-2">
        {c.does.map((d) => (
          <li key={d} className="flex gap-2">
            <CheckCircle aria-hidden size={16} className="mt-0.5 shrink-0 text-ink-3" />
            {d}
          </li>
        ))}
      </ul>
      <form action={toggleConnectorRequestAction} className="mt-4">
        <input type="hidden" name="connector" value={c.key} />
        <SubmitButton aria-pressed={requested} className={cx(buttonClass(requested ? "secondary" : "ghost", "sm"), "w-full", requested ? "!text-good-ink" : "border border-dashed border-line")}>
          {requested ? (
            <>
              <CheckCircle aria-hidden size={14} weight="fill" /> Requested by your agency
            </>
          ) : (
            <>
              <Plus aria-hidden size={14} weight="bold" /> We want this
            </>
          )}
        </SubmitButton>
      </form>
    </li>
  );
}

export default async function ConnectorsPage() {
  const user = await requireUser();
  const requested = new Set((await tenant(user, (tx) => tx.q<{ connector: string }>("select connector from connector_requests"))).map((r) => r.connector));
  return (
    <>
      <PageHeader
        title="Connectors"
        subtitle="Bring the tools your agency already uses into 8gency. Connectors are on the roadmap: tell us which ones you need and we'll build those first."
        actions={
          <Link href="/app/automations" className={buttonClass("secondary")}>
            <Lightning aria-hidden size={16} /> Automations
          </Link>
        }
      />

      <section aria-label="How connectors will work" className="mb-6 grid gap-3 md:grid-cols-3">
        {[
          { icon: Plugs, title: "Connect once", body: "Sign in with Google, Microsoft, Slack or Xero. Access is encrypted, limited to what each feature needs, and can be disconnected any time." },
          { icon: ArrowsClockwise, title: "Mapped to your work", body: "Emails, meetings, files and ad spend are matched to the right client and job, so they show up where the work is." },
          { icon: ShieldCheck, title: "Used everywhere", body: "Connected apps become steps in Automations, sources for timesheets and status reports, and destinations for invoices." },
        ].map((s) => (
          <div key={s.title} className="flex gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
              <s.icon aria-hidden size={18} weight="bold" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">{s.title}</h2>
              <p className="mt-1 text-sm text-ink-2">{s.body}</p>
            </div>
          </div>
        ))}
      </section>

      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        {([1, 2, 3] as const).map((p) => (
          <span key={p} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-ink-2 shadow-xs">
            <b className="font-semibold text-ink">{PHASES[p].label}</b> {PHASES[p].detail}
          </span>
        ))}
      </div>

      <Stagger>
        {CATEGORIES.map((cat) => (
          <section key={cat} aria-labelledby={`cat-${cat}`} className="mb-8">
            <h2 id={`cat-${cat}`} className="mb-3 text-sm font-semibold">
              {cat}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {CONNECTORS.filter((c) => c.category === cat).map((c) => (
                <ConnectorCard key={c.key} c={c} requested={requested.has(c.key)} />
              ))}
            </ul>
          </section>
        ))}
      </Stagger>
    </>
  );
}

import {
  Calculator, CalendarBlank, ChartBar, CreditCard, DropboxLogo, EnvelopeSimple, FigmaLogo, GoogleDriveLogo, GoogleLogo, Handshake, Lightning, LinkedinLogo,
  MegaphoneSimple, MetaLogo, MicrosoftOutlookLogo, MicrosoftTeamsLogo, PaintBrush, SlackLogo, TiktokLogo, VideoCamera, WebhooksLogo, WhatsappLogo,
} from "@phosphor-icons/react/ssr";
import type { ConnectorIcon as Key } from "@/lib/domain/connectors";
import { cx } from "./ui";

const ICONS: Record<Key, typeof GoogleLogo> = {
  gmail: GoogleLogo, calendar: CalendarBlank, outlook: MicrosoftOutlookLogo, slack: SlackLogo, whatsapp: WhatsappLogo, teams: MicrosoftTeamsLogo,
  drive: GoogleDriveLogo, dropbox: DropboxLogo, figma: FigmaLogo, canva: PaintBrush, meta: MetaLogo, google_ads: MegaphoneSimple, linkedin: LinkedinLogo,
  analytics: ChartBar, tiktok: TiktokLogo, hubspot: Handshake, mailchimp: EnvelopeSimple, klaviyo: EnvelopeSimple, xero: Calculator, quickbooks: Calculator,
  sage: Calculator, payments: CreditCard, zoom: VideoCamera, webhooks: WebhooksLogo, zapier: Lightning,
};

export function ConnectorIcon({ icon, size = "md" }: { icon: Key; size?: "md" | "lg" }) {
  const Icon = ICONS[icon];
  return (
    <span className={cx("grid shrink-0 place-items-center rounded-xl border border-line bg-surface-2/60 text-ink", size === "lg" ? "h-12 w-12" : "h-11 w-11")}>
      <Icon aria-hidden size={size === "lg" ? 24 : 22} weight="duotone" />
    </span>
  );
}

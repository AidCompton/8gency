import {
  ArrowsLeftRight, Bell, Briefcase, CalendarBlank, ChatCircleText, CheckCircle, Clock, Coins, EnvelopeSimple, FileText, Funnel, Gauge, GoogleLogo, Handshake,
  Hourglass, ListChecks, PaperPlaneTilt, Receipt, Repeat, SlackLogo, Tray, WhatsappLogo,
} from "@phosphor-icons/react/ssr";
import type { IconKey } from "@/lib/domain/automations";
import { TONE, cx, type Tone } from "./ui";

// Usable from server and client components (the /ssr icons have no React context).
const ICONS = {
  briefcase: Briefcase, arrows: ArrowsLeftRight, send: PaperPlaneTilt, check: CheckCircle, chat: ChatCircleText, inbox: Tray, receipt: Receipt, coins: Coins,
  clock: Clock, hourglass: Hourglass, gauge: Gauge, bell: Bell, envelope: EnvelopeSimple, whatsapp: WhatsappLogo, tasks: ListChecks, slack: SlackLogo,
  gmail: GoogleLogo, calendar: CalendarBlank, funnel: Funnel, repeat: Repeat, handshake: Handshake, file: FileText,
} satisfies Record<IconKey, unknown>;

/** Node colour by role: triggers amber, filters blue, actions by what they touch. */
export function toneFor(kind: "trigger" | "filter" | "action", icon?: IconKey): Tone {
  if (kind === "trigger") return "warning";
  if (kind === "filter") return "info";
  if (icon === "whatsapp") return "good";
  if (icon === "envelope" || icon === "gmail") return "info";
  if (icon === "tasks") return "neutral";
  return "brand";
}

export function AutomationIcon({ icon, tone, size = "md" }: { icon: IconKey; tone: Tone; size?: "sm" | "md" | "lg" }) {
  const Icon = ICONS[icon];
  const box = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-11 w-11" : "h-9 w-9";
  return (
    <span aria-hidden className={cx("grid shrink-0 place-items-center rounded-lg", box, TONE[tone])}>
      <Icon size={size === "sm" ? 14 : size === "lg" ? 22 : 18} weight="bold" />
    </span>
  );
}

/** Trigger → actions as a row of small connected tiles (list cards and the template gallery). */
export function MiniFlow({ steps }: { steps: { icon: IconKey; kind: "trigger" | "filter" | "action" }[] }) {
  return (
    <span className="flex items-center">
      {steps.map((s, i) => (
        <span key={i} className="flex items-center">
          {i > 0 && <span aria-hidden className="h-px w-4 bg-line" />}
          <AutomationIcon icon={s.icon} tone={toneFor(s.kind, s.icon)} size="sm" />
        </span>
      ))}
    </span>
  );
}

import { ArrowsClockwise, CaretRight, CheckCircle, Lightning, Plugs, Plus, ShieldCheck, WarningCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { ConnectorIcon } from "@/components/ConnectorIcon";
import { Stagger } from "@/components/Motion";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, PageHeader, buttonClass, cx } from "@/components/ui";
import { toggleConnectorRequestAction } from "../_actions/connectors";
import { requireUser, tenant } from "@/lib/auth";
import { PROVIDERS } from "@/lib/connectors/providers";
import { CONNECTORS, PHASES, type ConnectorDef } from "@/lib/domain/connectors";

export const metadata = { title: "Connectors" };

const BUILT = new Set(PROVIDERS.map((p) => p.catalog));

const CATEGORIES = [...new Set(CONNECTORS.map((c) => c.category))];

type State = "connected" | "reauth" | null;

function ConnectorCard({ c, requested, state }: { c: ConnectorDef; requested: boolean; state: State }) {
  const built = BUILT.has(c.key);
  return (
    <li id={c.key} data-stagger className="flex scroll-mt-24 flex-col rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <ConnectorIcon icon={c.icon} />
        {state === "connected" ? (
          <Badge tone="good" dot>Connected</Badge>
        ) : state === "reauth" ? (
          <Badge tone="critical" dot>Reconnect</Badge>
        ) : built ? (
          <Badge tone="brand" dot>Available</Badge>
        ) : (
          <Badge dot>{PHASES[c.phase].label}</Badge>
        )}
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
      {built ? (
        <Link href={`/app/connectors/${c.key}`} className={cx(buttonClass(state ? "secondary" : "primary", "sm"), "mt-4 w-full")}>
          {state === "reauth" ? <WarningCircle aria-hidden size={14} /> : state ? null : <Plugs aria-hidden size={14} />}
          {state === "connected" ? "Manage" : state === "reauth" ? "Reconnect" : "Connect"}
          <CaretRight aria-hidden size={12} weight="bold" />
        </Link>
      ) : (
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
      )}
    </li>
  );
}

export default async function ConnectorsPage() {
  const user = await requireUser();
  const data = await tenant(user, async (tx) => ({
    requested: new Set((await tx.q<{ connector: string }>("select connector from connector_requests")).map((r) => r.connector)),
    // Agency-wide connections, plus the signed-in person's own (calendars, Zoom).
    conns: await tx.q<{ provider: string; status: string }>("select provider, status from connections where user_id is null or user_id = $1", [user.id]),
  }));
  const state = (key: string): State => {
    const mine = data.conns.filter((x) => PROVIDERS.find((p) => p.key === x.provider)?.catalog === key);
    return mine.some((x) => x.status === "needs_reauth") ? "reauth" : mine.length ? "connected" : null;
  };
  return (
    <>
      <PageHeader
        title="Connectors"
        subtitle="Bring the tools your agency already uses into 8gency: email, calendars, Slack, WhatsApp, accounting, ad platforms, files and payments."
        actions={
          <Link href="/app/automations" className={buttonClass("secondary")}>
            <Lightning aria-hidden size={16} /> Automations
          </Link>
        }
      />

      <section aria-label="How connectors work" className="mb-6 grid gap-3 md:grid-cols-3">
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
                <ConnectorCard key={c.key} c={c} requested={data.requested.has(c.key)} state={state(c.key)} />
              ))}
            </ul>
          </section>
        ))}
      </Stagger>
    </>
  );
}

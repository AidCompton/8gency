import type { ReactNode } from "react";
import { Money, cx } from "./ui";

export interface PaperEntity {
  name: string;
  legal_name: string;
  address: string;
  registration_number: string;
  tax_number: string;
  bank_details: string;
}

/**
 * The invoice document: the same sheet on the staff page, in the editor, on the
 * client hub and on paper. Always light (`.paper` pins the light tokens), so it
 * reads like the PDF it prints as.
 */
export function InvoicePaper({
  logoUrl,
  agencyName,
  brandColor,
  entity,
  heading,
  number,
  meta,
  billTo,
  amountDue,
  stamp,
  children,
  footer,
}: {
  logoUrl?: string | null;
  agencyName: string;
  brandColor: string;
  entity: PaperEntity;
  heading: string;
  number: ReactNode;
  meta: { label: string; value: ReactNode }[];
  billTo: { name: string; lines?: ReactNode[] };
  amountDue?: { cents: number; currency: string; label: string };
  stamp?: { label: string; tone: "good" | "neutral" | "critical" };
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <article className="paper relative overflow-hidden rounded-xl border border-line bg-surface text-ink shadow-md print:rounded-none print:border-0 print:shadow-none">
      <div aria-hidden className="h-1.5 print:hidden" style={{ background: brandColor }} />
      <div className="p-6 sm:p-10 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={`${agencyName} logo`} className="mb-4 block max-h-16 max-w-[220px] object-contain object-left" />
            ) : null}
            <div className="text-base font-semibold" style={logoUrl ? undefined : { color: brandColor }}>
              {entity.legal_name || entity.name}
            </div>
            {entity.address && <div className="mt-1 whitespace-pre-line text-xs leading-relaxed text-ink-2">{entity.address}</div>}
            {(entity.registration_number || entity.tax_number) && (
              <div className="mt-1 text-xs text-ink-2">
                {entity.registration_number && `Reg ${entity.registration_number}`}
                {entity.registration_number && entity.tax_number && " · "}
                {entity.tax_number && `VAT no. ${entity.tax_number}`}
              </div>
            )}
          </div>
          <div className="sm:text-right">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-3">{heading}</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">{number}</div>
            <dl className="mt-3 grid grid-cols-[auto_auto] justify-start gap-x-4 gap-y-1 text-xs sm:justify-end">
              {meta.map((m) => (
                <div key={m.label} className="contents">
                  <dt className="text-ink-3">{m.label}</dt>
                  <dd className="tnum font-medium text-ink sm:text-right">{m.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </header>

        <div className="mt-8 flex flex-wrap items-end justify-between gap-6 border-y border-line py-5">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-ink-3">Bill to</div>
            <div className="mt-1 font-semibold">{billTo.name}</div>
            {billTo.lines?.map((l, i) => (
              <div key={i} className="text-sm text-ink-2">
                {l}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {stamp && (
              <span
                className={cx(
                  "rounded-md border-2 px-2 py-0.5 text-xs font-bold uppercase tracking-widest",
                  stamp.tone === "good" ? "border-good-ink text-good-ink" : stamp.tone === "critical" ? "border-critical-ink text-critical-ink" : "border-ink-3 text-ink-3",
                )}
              >
                {stamp.label}
              </span>
            )}
            {amountDue && (
              <div className="sm:text-right">
                <div className="text-xs font-medium uppercase tracking-wider text-ink-3">{amountDue.label}</div>
                <div className="text-2xl font-semibold tracking-tight">
                  <Money cents={amountDue.cents} currency={amountDue.currency} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6">{children}</div>

        <footer className="mt-10 border-t border-line pt-4 text-xs leading-relaxed text-ink-2">{footer}</footer>
      </div>
    </article>
  );
}

/** Subtotal / tax / total block, right-aligned under the lines. */
export function PaperTotals({ rows }: { rows: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean }[] }) {
  return (
    <dl className="ml-auto mt-4 w-full max-w-72 space-y-1.5 text-sm">
      {rows.map((r, i) => (
        <div key={i} className={cx("flex justify-between gap-4", r.strong && "border-t border-line pt-2 text-base font-semibold", r.muted && "text-ink-2")}>
          <dt>{r.label}</dt>
          <dd className="tnum">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Read-only line table for an issued invoice (staff page and client hub). */
export function PaperLines({ lines, currency }: { lines: { id: string; description: string; quantity: number; unit_cents: number; amount_cents: number }[]; currency: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wider text-ink-3">
            <th className="py-2 pr-2 font-medium">Description</th>
            <th className="w-16 py-2 pl-3 text-right font-medium">Qty</th>
            <th className="w-32 py-2 pl-3 text-right font-medium">Unit price</th>
            <th className="w-32 py-2 pl-3 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b border-line">
              <td className="py-2.5 pr-2">{l.description}</td>
              <td className="tnum py-2.5 pl-3 text-right">{l.quantity}</td>
              <td className="whitespace-nowrap py-2.5 pl-3 text-right"><Money cents={l.unit_cents} currency={currency} /></td>
              <td className="whitespace-nowrap py-2.5 pl-3 text-right font-medium"><Money cents={l.amount_cents} currency={currency} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { LockSimple } from "@phosphor-icons/react/ssr";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Flash } from "@/components/Flash";
import { Avatar } from "@/components/ui";
import { resolveHubToken } from "@/lib/services/hub";

export const metadata = { title: "Client hub", robots: { index: false, follow: false } };

export default async function HubLayout({ children, params }: { children: React.ReactNode; params: Promise<{ token: string }> }) {
  const { token } = await params;
  const contact = await resolveHubToken(token);
  if (!contact) notFound();
  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur-md">
        <div aria-hidden className="h-1" style={{ background: contact.agency_color }} />
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-bold text-white shadow-sm" style={{ background: contact.agency_color }} aria-hidden>
                {contact.agency_name.charAt(0).toUpperCase()}
              </span>
              <span className="truncate font-semibold tracking-tight">{contact.agency_name}</span>
          </div>
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="min-w-0 text-right">
              <div className="truncate text-sm font-medium">{contact.name}</div>
              <div className="truncate text-xs text-ink-3">{contact.company_name}</div>
            </div>
            <Avatar name={contact.name} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <Suspense>
          <Flash />
        </Suspense>
        {children}
      </main>
      <footer className="no-print flex items-center justify-center gap-1.5 pb-10 text-xs text-ink-3">
        <LockSimple aria-hidden size={12} /> Private link for {contact.name}. Please don't forward it. Powered by 8gency.
      </footer>
    </div>
  );
}

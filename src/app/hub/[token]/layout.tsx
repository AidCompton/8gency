import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Flash } from "@/components/Flash";
import { resolveHubToken } from "@/lib/services/hub";

export const metadata = { title: "Client hub", robots: { index: false, follow: false } };

export default async function HubLayout({ children, params }: { children: React.ReactNode; params: Promise<{ token: string }> }) {
  const contact = await resolveHubToken((await params).token);
  if (!contact) notFound();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <span className="h-6 w-6 rounded-md" style={{ background: contact.agency_color }} aria-hidden />
            {contact.agency_name}
          </div>
          <div className="text-right text-xs text-ink-2">{contact.company_name}<br />{contact.name}</div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Suspense><Flash /></Suspense>
        {children}
      </main>
      <footer className="pb-8 text-center text-xs text-ink-3">Private link for {contact.name}. Please don't forward it. Powered by 8gency.</footer>
    </div>
  );
}

import { Compass } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { ProductMark, buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4">
      <ProductMark />
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-8 text-center shadow-sm">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand/10 text-brand">
          <Compass aria-hidden size={24} />
        </span>
        <h1 className="mt-4 text-lg font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-ink-2">This page doesn't exist, or the link has expired. If a client link stopped working, ask your agency for a fresh one.</p>
        <Link href="/" className={buttonClass("secondary", "md") + " mt-6"}>
          Go to 8gency
        </Link>
      </div>
    </main>
  );
}

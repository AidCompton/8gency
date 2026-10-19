import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-ink-2">This page doesn't exist, or the link has expired.</p>
        <Link href="/" className="mt-4 inline-block text-sm text-brand hover:underline">8gency home</Link>
      </div>
    </main>
  );
}

export default function Loading() {
  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-56 animate-pulse rounded-lg bg-surface-2" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2" />)}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-surface-2" />
    </div>
  );
}

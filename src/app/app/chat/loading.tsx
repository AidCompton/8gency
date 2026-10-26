import { Skeleton, SkeletonScreen } from "@/components/ui";

/** The chat frame while it loads: sidebar rows on the left, messages on the right. */
export default function Loading() {
  return (
    <SkeletonScreen>
      <div data-bleed className="-mx-4 -my-6 flex h-[calc(100dvh-7.5rem)] overflow-hidden border-line bg-surface sm:-mx-6 md:h-[calc(100dvh-4rem)] lg:-mx-8 lg:-my-8">
        <aside className="hidden w-64 shrink-0 space-y-3 border-r border-line bg-surface-2/40 p-3 md:block">
          <Skeleton className="h-8 w-full" />
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
        </aside>
        <section className="min-w-0 flex-1 space-y-5 p-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-4 w-full max-w-md" /></div>
            </div>
          ))}
        </section>
      </div>
    </SkeletonScreen>
  );
}

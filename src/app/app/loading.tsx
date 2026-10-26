import { Card, PageHeader, Skeleton, SkeletonScreen, Stat, Table, Td } from "@/components/ui";

/** What a page looks like before its data arrives: the real shells, with blocks where the text goes. */
export default function Loading() {
  return (
    <SkeletonScreen>
      <PageHeader title={<Skeleton className="h-7 w-48" />} subtitle={<Skeleton className="mt-2 h-4 w-80 max-w-full" />} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Stat key={i} label="" value={<Skeleton className="h-8 w-24" />} hint={<Skeleton className="h-3 w-28" />} />)}
      </div>
      <Card pad={false}>
        <Table head={["", "", "", ""]}>
          {[0, 1, 2, 3, 4].map((r) => (
            <tr key={r}>
              <Td><Skeleton className="h-4 w-44" /></Td>
              <Td><Skeleton className="h-4 w-24" /></Td>
              <Td><Skeleton className="h-4 w-16" /></Td>
              <Td><Skeleton className="h-5 w-20 rounded-full" /></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </SkeletonScreen>
  );
}

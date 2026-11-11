import { Skeleton } from '@/components/ui/skeleton';

/** Fallback while an admin page streams its session-dependent content. */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-11 w-full max-w-sm" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

/** Fallback for the whole admin frame (sidebar + top bar) while the session is checked. */
export function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh" aria-busy="true">
      <div className="border-line-200 hidden w-64 shrink-0 border-r lg:block" />
      <div className="flex flex-1 flex-col">
        <div className="border-line-200 min-h-14 border-b" />
        <div className="px-4 py-6 lg:px-8">
          <PageSkeleton />
        </div>
      </div>
    </div>
  );
}

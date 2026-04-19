// Placeholder rows for first-load list pages before data arrives.
// Shaped like ListRow so the page stays visually stable while queries
// resolve. Uses the same py-3.5 as ListRow / ActivityRow.
export function SkeletonRow() {
  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800/50 py-3.5 flex items-center gap-3">
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="h-3 w-2/3 rounded bg-zinc-200 dark:bg-zinc-800/70 animate-pulse" />
        <div className="h-2.5 w-1/3 rounded bg-zinc-200/70 dark:bg-zinc-800/50 animate-pulse" />
      </div>
    </div>
  )
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="[&>:last-child]:border-b-0">
      {Array.from({ length: count }).map((_, i) => <SkeletonRow key={i} />)}
    </div>
  )
}

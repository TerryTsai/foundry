export function SectionLabel({ label }: { label: string }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-500 pb-1 pt-2">
      {label}
    </div>
  )
}

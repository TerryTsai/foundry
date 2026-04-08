export function SectionLabel({ label }: { label: string }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600 px-4 pb-1">
      {label}
    </div>
  )
}

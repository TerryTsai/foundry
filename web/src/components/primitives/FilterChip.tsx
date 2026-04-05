interface FilterChipProps {
  label: string
  active: boolean
  onPress: () => void
}

export function FilterChip({ label, active, onPress }: FilterChipProps) {
  return (
    <button
      onClick={onPress}
      className={`font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 shrink-0 border transition-colors ${
        active
          ? 'border-zinc-400 text-zinc-100'
          : 'border-zinc-800 text-zinc-600 active:border-zinc-600'
      }`}
    >
      {label}
    </button>
  )
}

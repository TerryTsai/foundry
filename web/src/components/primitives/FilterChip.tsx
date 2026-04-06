interface FilterChipProps {
  label: string
  active: boolean
  onPress: () => void
}

export function FilterChip({ label, active, onPress }: FilterChipProps) {
  return (
    <button
      onClick={onPress}
      className={`text-xs px-3 py-1.5 shrink-0 rounded-full border transition-colors ${
        active
          ? 'border-zinc-500 text-zinc-100 bg-zinc-800'
          : 'border-zinc-800 text-zinc-500 active:border-zinc-600'
      }`}
    >
      {label}
    </button>
  )
}

interface InfoRow {
  label: string
  value: React.ReactNode
}

export function InfoGroup({ rows }: { rows: InfoRow[] }) {
  return (
    <div className="text-sm space-y-1.5 border-b border-zinc-800 pb-3">
      {rows.filter(r => r.value != null).map(({ label, value }) => (
        <div key={label} className="flex gap-3">
          <span className="text-zinc-500 shrink-0 w-20">{label}</span>
          <span className="text-zinc-300 font-mono text-xs leading-5 break-all">{value}</span>
        </div>
      ))}
    </div>
  )
}

interface InfoRow {
  label: string
  value: React.ReactNode
}

export function InfoGroup({ rows }: { rows: InfoRow[] }) {
  return (
    <div className="font-mono text-xs space-y-0.5 border-b border-zinc-800 pb-3">
      {rows.filter(r => r.value != null).map(({ label, value }) => (
        <div key={label} className="text-zinc-600">
          {label} <span className="text-zinc-400">{value}</span>
        </div>
      ))}
    </div>
  )
}

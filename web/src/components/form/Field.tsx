export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">{label}</label>
      {children}
    </div>
  )
}

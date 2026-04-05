export type Tab = 'tickets' | 'agents' | 'repo' | 'logs'

const tabs: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'tickets', label: 'Tickets', icon: '□' },
  { id: 'agents',  label: 'Agents',  icon: '◎' },
  { id: 'repo',    label: 'Repo',    icon: '⊞' },
  { id: 'logs',    label: 'Logs',    icon: '≡' },
]

interface TabBarProps {
  current: Tab
  onChange: (tab: Tab) => void
}

export function TabBar({ current, onChange }: TabBarProps) {
  return (
    <nav className="flex border-t border-zinc-800 bg-zinc-950 shrink-0">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors ${
            current === t.id ? 'text-zinc-100' : 'text-zinc-600'
          }`}
        >
          <span className="text-sm leading-none">{t.icon}</span>
          <span className="font-mono text-[9px] uppercase tracking-widest leading-none">{t.label}</span>
        </button>
      ))}
    </nav>
  )
}

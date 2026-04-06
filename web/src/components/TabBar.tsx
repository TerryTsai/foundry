import { Ticket, Bot, GitBranch, Activity } from 'lucide-react'

export type Tab = 'tickets' | 'agents' | 'repo' | 'logs'

const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'tickets', label: 'Tickets', icon: <Ticket size={18} strokeWidth={1.5} /> },
  { id: 'agents',  label: 'Agents',  icon: <Bot size={18} strokeWidth={1.5} /> },
  { id: 'repo',    label: 'Repo',    icon: <GitBranch size={18} strokeWidth={1.5} /> },
  { id: 'logs',    label: 'Logs',    icon: <Activity size={18} strokeWidth={1.5} /> },
]

interface TabBarProps {
  current: Tab
  onChange: (tab: Tab) => void
}

export function TabBar({ current, onChange }: TabBarProps) {
  return (
    <nav className="flex border-t border-zinc-800/60 bg-zinc-950 shrink-0">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-1 transition-colors ${
            current === t.id ? 'text-zinc-100' : 'text-zinc-500'
          }`}
        >
          {t.icon}
          <span className="text-[10px] leading-none">{t.label}</span>
        </button>
      ))}
    </nav>
  )
}

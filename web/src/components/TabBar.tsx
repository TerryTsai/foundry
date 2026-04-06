import { Ticket, Bot, FolderOpen, Activity } from 'lucide-react'

export type Tab = 'tickets' | 'agents' | 'files' | 'logs'

const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'tickets', label: 'Tickets', icon: <Ticket size={18} strokeWidth={1.5} /> },
  { id: 'agents',  label: 'Agents',  icon: <Bot size={18} strokeWidth={1.5} /> },
  { id: 'files',   label: 'Files',   icon: <FolderOpen size={18} strokeWidth={1.5} /> },
  { id: 'logs',    label: 'Logs',    icon: <Activity size={18} strokeWidth={1.5} /> },
]

interface TabBarProps {
  current: Tab
  onChange: (tab: Tab) => void
}

export function TabBar({ current, onChange }: TabBarProps) {
  return (
    <nav className="flex lg:hidden border-t border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-950 shrink-0">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-1 transition-colors relative ${
            current === t.id ? 'text-amber-400' : 'text-zinc-400 dark:text-zinc-500'
          }`}
        >
          {current === t.id && (
            <span className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-px bg-amber-400 rounded-full" />
          )}
          {t.icon}
          <span className="text-[10px] leading-none">{t.label}</span>
        </button>
      ))}
    </nav>
  )
}

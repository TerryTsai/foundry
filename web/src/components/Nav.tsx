import { NavLink } from 'react-router-dom'

const links = [
  { to: '/tickets', label: 'Tickets', icon: '□' },
  { to: '/projects', label: 'Projects', icon: '◈' },
  { to: '/agents', label: 'Agents', icon: '◎' },
  { to: '/repo', label: 'Repo', icon: '⊞' },
  { to: '/logs', label: 'Logs', icon: '≡' },
]

export function TopNav() {
  return (
    <nav className="hidden md:flex border-b border-zinc-200 dark:border-zinc-800 px-4 items-center gap-0 h-10 shrink-0">
      <span className="font-display font-bold text-xs tracking-[0.2em] uppercase text-zinc-900 dark:text-zinc-100 mr-6">
        Foundry
      </span>
      {links.map(l => (
        <NavLink
          key={l.to}
          to={l.to}
          className={({ isActive }) =>
            `font-mono text-xs px-3 h-full flex items-center border-b-2 -mb-px transition-colors ${
              isActive
                ? 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100'
                : 'border-transparent text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`
          }
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  )
}

export function BottomNav() {
  return (
    <nav className="md:hidden flex border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0">
      {links.map(l => (
        <NavLink
          key={l.to}
          to={l.to}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors ${
              isActive ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-600'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span className="text-sm leading-none">{l.icon}</span>
              <span className={`font-mono text-[9px] uppercase tracking-widest leading-none ${
                isActive ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-600'
              }`}>
                {l.label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

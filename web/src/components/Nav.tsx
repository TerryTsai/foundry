import { NavLink } from 'react-router-dom'

const links = [
  { to: '/tickets', label: 'Tickets', icon: '⬜' },
  { to: '/projects', label: 'Projects', icon: '◈' },
  { to: '/agents', label: 'Agents', icon: '◎' },
  { to: '/repo', label: 'Repo', icon: '⊞' },
]

// Top bar shown on md+ only
export function TopNav() {
  return (
    <nav className="hidden md:flex border-b border-zinc-800 px-4 items-center gap-1 h-12 shrink-0">
      <span className="font-display font-bold text-zinc-100 mr-4 text-sm tracking-wide">FOUNDRY</span>
      {links.map(l => (
        <NavLink
          key={l.to}
          to={l.to}
          className={({ isActive }) =>
            `font-mono text-xs px-3 py-1.5 rounded transition-colors ${
              isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`
          }
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  )
}

// Bottom tab bar shown on mobile only
export function BottomNav() {
  return (
    <nav className="md:hidden flex border-t border-zinc-800 bg-zinc-950 shrink-0 safe-bottom">
      {links.map(l => (
        <NavLink
          key={l.to}
          to={l.to}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center py-3 gap-0.5 transition-colors ${
              isActive ? 'text-zinc-100' : 'text-zinc-600'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span className="text-base leading-none">{l.icon}</span>
              <span className={`font-mono text-[10px] leading-none ${isActive ? 'text-zinc-100' : 'text-zinc-600'}`}>
                {l.label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

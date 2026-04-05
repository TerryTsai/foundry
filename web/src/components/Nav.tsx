import { NavLink } from 'react-router-dom'

const links = [
  { to: '/tickets', label: 'Tickets' },
  { to: '/projects', label: 'Projects' },
  { to: '/agents', label: 'Agents' },
  { to: '/repo', label: 'Repo' },
]

export function Nav() {
  return (
    <nav className="border-b border-zinc-800 px-4 flex items-center gap-1 h-12 shrink-0">
      <span className="font-display font-bold text-zinc-100 mr-4 text-sm tracking-wide">FOUNDRY</span>
      {links.map(l => (
        <NavLink
          key={l.to}
          to={l.to}
          className={({ isActive }) =>
            `font-mono text-xs px-3 py-1.5 rounded transition-colors ${
              isActive
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`
          }
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  )
}

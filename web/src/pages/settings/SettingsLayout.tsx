import { Outlet, NavLink, Link, useMatch } from 'react-router-dom'
import { Bot, Link2, FolderOpen, User, type LucideIcon } from 'lucide-react'
import { FoundryMark } from '../../Shell.js'
import { AvatarMenu } from '../../components/AvatarMenu.js'
import { ListRow } from '../../components/list/ListRow.js'

const navItems: Array<{ to: string; label: string; Icon: LucideIcon; subtitle: string }> = [
  { to: '/settings/agents',      label: 'Agents',      Icon: Bot,       subtitle: 'LLM agents and their config' },
  { to: '/settings/connections', label: 'Connections', Icon: Link2,     subtitle: 'API keys and integrations' },
  { to: '/settings/projects',    label: 'Projects',    Icon: FolderOpen, subtitle: 'Repositories and quotas' },
  { to: '/settings/profile',     label: 'Profile',     Icon: User,      subtitle: 'Account and preferences' },
]

// Shown in the desktop right panel when no section is selected
function SettingsIndexPlaceholder() {
  return (
    <div className="flex items-center justify-center h-full text-sm text-zinc-400 dark:text-zinc-600 select-none">
      Select a category
    </div>
  )
}

export { SettingsIndexPlaceholder }

export function SettingsLayout() {
  // Detect bare /settings index to decide mobile rendering
  const isIndex = !!useMatch('/settings')

  return (
    <div className="flex flex-col h-dvh bg-white dark:bg-zinc-950">
      <header className="flex items-center h-12 shrink-0 px-4 gap-3 border-b border-zinc-300 dark:border-zinc-800/60 bg-white dark:bg-zinc-950">
        <Link to="/" className="flex items-center gap-2.5 shrink-0 mr-1">
          <FoundryMark />
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 font-display">Foundry</span>
        </Link>
        <span className="text-zinc-300 dark:text-zinc-700 text-sm select-none">/</span>
        <span className="text-sm text-zinc-500 dark:text-zinc-400 flex-1">Settings</span>
        <AvatarMenu />
      </header>

      <div className="flex flex-1 min-h-0">
        {/* ── Desktop sidebar ───────────────────────────────────────────────── */}
        <aside className="hidden lg:flex flex-col w-48 shrink-0 border-r border-zinc-200 dark:border-zinc-800/60 pt-3 gap-0.5">
          {navItems.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 mx-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'text-amber-400 bg-amber-400/5'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                }`
              }
            >
              <Icon size={15} strokeWidth={1.5} />
              {label}
            </NavLink>
          ))}
        </aside>

        {/* ── Outlet — always on desktop, hidden on mobile at index ─────────── */}
        <div className={`flex-1 min-h-0 min-w-0 overflow-y-auto ${isIndex ? 'hidden lg:block' : 'block'}`}>
          <Outlet />
        </div>

        {/* ── Mobile full-screen nav list — only at bare /settings index ───── */}
        {isIndex && (
          <div className="lg:hidden flex-1 flex flex-col min-h-0 overflow-y-auto px-4 pt-4">
            <div className="[&>:last-child>*]:border-b-0">
              {navItems.map(({ to, label, subtitle }) => (
                <Link key={to} to={to} className="block">
                  <ListRow title={label} subtitle={subtitle} />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

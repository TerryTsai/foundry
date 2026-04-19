import { Outlet, NavLink, Link, useMatch } from 'react-router-dom'
import { Bot, Link2, FolderOpen, User, type LucideIcon } from 'lucide-react'
import { AppHeader } from '../../components/layout/AppHeader.js'
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
    <div className="bg-white dark:bg-zinc-950 min-h-dvh">
      <AppHeader><span className="text-sm text-zinc-500 dark:text-zinc-400">Settings</span></AppHeader>

      <div className="flex min-w-0">
        {/* ── Desktop sidebar (sticky) ──────────────────────────────────────── */}
        <aside className="hidden lg:flex flex-col w-48 shrink-0 border-r border-zinc-200 dark:border-zinc-800/60 pt-3 gap-0.5 sticky top-12 self-start h-[calc(100dvh-3rem)] overflow-y-auto">
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
        <div className={`flex-1 min-w-0 ${isIndex ? 'hidden lg:block' : 'block'}`}>
          <Outlet />
        </div>

        {/* ── Mobile full-screen nav list — only at bare /settings index ───── */}
        {isIndex && (
          <div className="lg:hidden flex-1 px-4 pt-4">
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

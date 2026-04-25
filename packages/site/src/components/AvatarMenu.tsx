import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Settings, LogOut, Sun, Moon, Monitor, BarChart3 } from 'lucide-react'
import { authApi } from '../api.js'
import { authMeOpts } from '../queries.js'
import { useTheme, type ThemeMode } from '../theme.js'

const THEME_CYCLE: ThemeMode[] = ['system', 'light', 'dark']

export function AvatarMenu() {
  const [open,    setOpen]    = useState(false)
  const [pos,     setPos]     = useState<{ top: number; right: number } | null>(null)
  const { data: account } = useQuery(authMeOpts())
  const btnRef = useRef<HTMLButtonElement>(null)
  const { mode, setMode } = useTheme()

  function handleOpen() {
    if (open) { setOpen(false); return }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
    setOpen(true)
  }

  async function handleLogout() {
    setOpen(false)
    await authApi.logout()
    location.assign('/login')
  }

  function cycleTheme() {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(mode) + 1) % THEME_CYCLE.length]
    setMode(next)
  }

  const initials = account?.login?.[0]?.toUpperCase() ?? '·'
  const ThemeIcon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor

  const dropdown = open && pos && createPortal(
    <>
      <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
      <div
        style={{ position: 'fixed', top: pos.top, right: pos.right, width: 192, zIndex: 9999 }}
        className="bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700/60 rounded-lg shadow-xl py-1"
      >
        {/* ── Account identity ── */}
        {account && (
          <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 mb-1">
            <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">{account.name ?? account.login}</div>
            <div className="text-[10px] text-zinc-500 truncate">{account.login}</div>
          </div>
        )}

        {/* ── Account-level views ── */}
        <Link
          to="/analytics"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
        >
          <BarChart3 size={12} strokeWidth={2} />
          Analytics
        </Link>
        <Link
          to="/settings"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
        >
          <Settings size={12} strokeWidth={2} />
          Settings
        </Link>

        <div className="border-t border-zinc-200 dark:border-zinc-800 my-1" />

        {/* ── Preferences ── */}
        <button
          onClick={cycleTheme}
          className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
        >
          <ThemeIcon size={12} strokeWidth={2} />
          Theme: {mode}
        </button>

        <div className="border-t border-zinc-200 dark:border-zinc-800 my-1" />

        {/* ── Auth ── */}
        <button
          onClick={handleLogout}
          className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
        >
          <LogOut size={12} strokeWidth={2} />
          Logout
        </button>
      </div>
    </>,
    document.body,
  )

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        title="Account"
        className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      >
        {account?.avatar_url ? (
          <img src={account.avatar_url} alt="" className="w-5 h-5 rounded-full" />
        ) : (
          <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] text-zinc-600 dark:text-zinc-300 flex items-center justify-center font-medium select-none">
            {initials}
          </span>
        )}
      </button>
      {dropdown}
    </>
  )
}

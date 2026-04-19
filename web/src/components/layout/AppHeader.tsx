import { Link } from 'react-router-dom'
import { AvatarMenu } from '../AvatarMenu.js'

export function FoundryMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0 text-amber-400">
      <path d="M10 1 L19 10 L10 19 L1 10 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 5.5 L14.5 10 L10 14.5 L5.5 10 Z" fill="currentColor" />
    </svg>
  )
}

export function AppHeader({ children }: { children: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 flex items-center h-12 shrink-0 px-4 gap-3 border-b border-zinc-300 dark:border-zinc-800/60 bg-white dark:bg-zinc-950">
      <Link to="/" className="flex items-center gap-2.5 shrink-0 mr-1">
        <FoundryMark />
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 font-display">Foundry</span>
      </Link>
      <span className="text-zinc-300 dark:text-zinc-700 text-sm select-none">/</span>
      <div className="flex-1 min-w-0">{children}</div>
      <AvatarMenu />
    </header>
  )
}

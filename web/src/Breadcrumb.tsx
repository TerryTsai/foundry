import { createContext, useContext, useState, useCallback } from 'react'
import { Link, useMatches } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

// ── Context for dynamic labels ──

const BreadcrumbContext = createContext<{
  labels: Record<string, string>
  setLabel: (path: string, label: string) => void
}>({ labels: {}, setLabel: () => {} })

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = useState<Record<string, string>>({})
  const setLabel = useCallback((path: string, label: string) => {
    setLabels(prev => prev[path] === label ? prev : { ...prev, [path]: label })
  }, [])
  return <BreadcrumbContext.Provider value={{ labels, setLabel }}>{children}</BreadcrumbContext.Provider>
}

export function useBreadcrumbLabel(label: string) {
  const { setLabel } = useContext(BreadcrumbContext)
  const matches = useMatches()
  const currentPath = matches[matches.length - 1]?.pathname ?? ''
  // Set on every render so label stays current
  if (currentPath) setLabel(currentPath, label)
}

// ── Crumb computation ──

interface MatchHandle { crumb?: string }

function useCrumbs() {
  const matches = useMatches()
  const { labels } = useContext(BreadcrumbContext)

  return matches
    .filter(m => (m.handle as MatchHandle)?.crumb)
    .map(m => ({
      label: labels[m.pathname] ?? (m.handle as MatchHandle).crumb!,
      path: m.pathname,
    }))
    .filter(c => c.label !== 'Project')
}

// ── Desktop Breadcrumb (full trail) ──

export function Breadcrumb() {
  const crumbs = useCrumbs()
  if (crumbs.length === 0) return null

  return (
    <nav className="hidden lg:flex items-center gap-1 px-6 h-10 shrink-0 border-b border-zinc-200 dark:border-zinc-800/60">
      {crumbs.map((c, i) => (
        <span key={c.path} className="flex items-center gap-1 shrink-0">
          {i > 0 && <ChevronRight size={12} className="text-zinc-400 dark:text-zinc-700" />}
          {i < crumbs.length - 1 ? (
            <Link to={c.path} className="text-xs text-zinc-600 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
              {c.label}
            </Link>
          ) : (
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

// ── Mobile Breadcrumb (back link only) ──

export function MobileBreadcrumb({ fallback }: { fallback?: React.ReactNode }) {
  const crumbs = useCrumbs()

  if (crumbs.length <= 1) return fallback ? <>{fallback}</> : null

  const parent = crumbs[crumbs.length - 2]

  return (
    <Link to={parent.path} className="flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500">
      <ChevronRight size={10} className="rotate-180" />
      <span>{parent.label}</span>
    </Link>
  )
}

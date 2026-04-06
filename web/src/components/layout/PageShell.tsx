import { useRef, useState } from 'react'

interface PageShellProps {
  action?: { label: string; onPress: () => void }
  onRefresh?: () => Promise<void>
  children: React.ReactNode
}

export function PageShell({ action, onRefresh, children }: PageShellProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const startY = useRef(0)
  const [refreshing, setRefreshing] = useState(false)

  const handleTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY
  }

  const handleTouchEnd = async (e: React.TouchEvent) => {
    if (!onRefresh) return
    const delta = e.changedTouches[0].clientY - startY.current
    if (delta > 70 && (scrollRef.current?.scrollTop ?? 0) === 0) {
      setRefreshing(true)
      try { await onRefresh() } finally { setRefreshing(false) }
    }
  }

  return (
    <div className="relative flex flex-col h-full">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 pt-4 pb-4"
        onTouchStart={onRefresh ? handleTouchStart : undefined}
        onTouchEnd={onRefresh ? handleTouchEnd : undefined}
      >
        {refreshing && (
          <div className="text-center py-2 text-xs text-zinc-400 dark:text-zinc-600">↻</div>
        )}
        {children}
      </div>

      {action && (
        <button
          onClick={action.onPress}
          className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 px-4 py-2 bg-sky-500/15 border border-sky-500/25 backdrop-blur-sm text-sky-600 dark:text-sky-300 text-sm font-medium rounded-full shadow-lg active:opacity-75 transition-opacity"
        >
          <span className="text-sky-500">+</span> {action.label}
        </button>
      )}
    </div>
  )
}

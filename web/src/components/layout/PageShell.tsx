import { useRef, useState } from 'react'

interface PageShellProps {
  title: string
  action?: { label: string; onPress: () => void }
  onRefresh?: () => Promise<void>
  children: React.ReactNode
}

export function PageShell({ title, action, onRefresh, children }: PageShellProps) {
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
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-2 shrink-0">
        <h1 className="font-display text-2xl font-bold text-zinc-100 tracking-tight">{title}</h1>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4"
        style={{ paddingBottom: 'calc(56px + env(safe-area-inset-bottom) + 88px)' }}
        onTouchStart={onRefresh ? handleTouchStart : undefined}
        onTouchEnd={onRefresh ? handleTouchEnd : undefined}
      >
        {refreshing && (
          <div className="text-center py-1 font-mono text-[10px] text-zinc-700">↻</div>
        )}
        {children}
      </div>

      {action && (
        <div
          className="fixed right-5 z-30"
          style={{ bottom: 'calc(56px + env(safe-area-inset-bottom) + 16px)' }}
        >
          <button
            onClick={action.onPress}
            className="flex items-center gap-2 px-4 h-10 bg-zinc-100 text-zinc-900 font-mono text-xs uppercase tracking-wider active:opacity-75 transition-opacity shadow-lg"
          >
            + {action.label}
          </button>
        </div>
      )}
    </div>
  )
}

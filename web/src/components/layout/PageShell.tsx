import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

const fabCls = 'absolute bottom-4 right-4 z-10 flex items-center gap-1.5 px-4 py-2 bg-sky-500/15 border border-sky-500/25 backdrop-blur-sm text-sky-600 dark:text-sky-300 text-sm font-medium rounded-full shadow-lg active:opacity-75 transition-opacity'

interface PageShellProps {
  action?: { label: string; onPress: string | (() => void) }
  composer?: { placeholder: string; onSubmit: (value: string) => Promise<void> }
  onRefresh?: () => Promise<void>
  children: React.ReactNode
}

export function PageShell({ action, composer, onRefresh, children }: PageShellProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const startY = useRef(0)
  const wasAtTop = useRef(false)
  const [refreshing, setRefreshing] = useState(false)
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')

  // React Router's <ScrollRestoration /> targets window — but our scroll
  // container is this inner div, so it wouldn't reach us. Persist per-
  // location scrollTop in sessionStorage so back/forward lands where you
  // left. Keyed by location.key so repeat visits to the same URL (fresh
  // navigation vs popstate) stay distinct.
  const { key } = useLocation()

  // Restore BEFORE paint so users never see a flash at scrollTop=0.
  // Query-backed content hydrates across frames, so the container's
  // scrollHeight starts short and the browser clamps the first assign.
  // Poll via rAF, re-applying each frame, until scrollTop settles at
  // target (scrollHeight is finally large enough). Bail on user
  // interaction or after ~1s so we never fight the user.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const storageKey = `scroll:${key}`
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return
    const target = +raw

    let raf = 0
    let frames = 0
    let cancelled = false
    const bail = () => { cancelled = true }
    el.addEventListener('wheel',     bail, { passive: true, once: true })
    el.addEventListener('touchmove', bail, { passive: true, once: true })

    const tick = () => {
      if (cancelled) return
      el.scrollTop = target
      const settled = Math.abs(el.scrollTop - target) <= 1
      if (settled || ++frames > 60) return
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      el.removeEventListener('wheel',     bail)
      el.removeEventListener('touchmove', bail)
    }
  }, [key])

  // Save scrollTop on scroll (throttled) and on unmount (so the last
  // position is recorded even if the user navigates away before rAF).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const storageKey = `scroll:${key}`
    let raf = 0
    const save = () => sessionStorage.setItem(storageKey, String(el.scrollTop))
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(save)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
      save()
    }
  }, [key])

  const handleTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY
    wasAtTop.current = (scrollRef.current?.scrollTop ?? 0) === 0
  }

  const handleTouchEnd = async (e: React.TouchEvent) => {
    if (!onRefresh || !wasAtTop.current) return
    const delta = e.changedTouches[0].clientY - startY.current
    if (delta > 70) {
      setRefreshing(true)
      try { await onRefresh() } finally { setRefreshing(false) }
    }
  }

  const hasAction = action || composer
  const showComposer = composer && composing

  async function handleComposerSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.trim() || !composer) return
    await composer.onSubmit(draft)
    setDraft('')
    setComposing(false)
  }

  return (
    <div className="relative flex flex-col h-full">
      {showComposer && <div className="absolute inset-0 z-10" onClick={() => { setComposing(false); setDraft('') }} />}

      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto px-4 pt-4 ${hasAction ? 'pb-16' : 'pb-4'}`}
        onTouchStart={onRefresh ? handleTouchStart : undefined}
        onTouchEnd={onRefresh ? handleTouchEnd : undefined}
      >
        {refreshing && (
          <div className="text-center py-2 text-xs text-zinc-500 dark:text-zinc-600">...</div>
        )}
        {children}
      </div>

      {showComposer ? (
        <form onSubmit={handleComposerSubmit} className="absolute bottom-4 left-4 right-4 z-10 flex items-center gap-2 px-4 py-2 bg-sky-500/15 border border-sky-500/25 backdrop-blur-sm rounded-full shadow-lg">
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={composer.placeholder}
            autoFocus
            className="bg-transparent text-base text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 dark:placeholder-zinc-500 outline-none flex-1 min-w-0"
          />
          <button type="submit" disabled={!draft.trim()} className="text-sky-500 text-sm font-medium disabled:opacity-30">
            add
          </button>
        </form>
      ) : action ? (
        typeof action.onPress === 'string' ? (
          <Link to={action.onPress} className={fabCls}>
            <span className="text-sky-500">+</span> {action.label}
          </Link>
        ) : (
          <button onClick={action.onPress} className={fabCls}>
            <span className="text-sky-500">+</span> {action.label}
          </button>
        )
      ) : composer ? (
        <button onClick={() => setComposing(true)} className={fabCls}>
          <span className="text-sky-500">+</span> {composer.placeholder}
        </button>
      ) : null}
    </div>
  )
}

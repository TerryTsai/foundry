import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Paperclip, X } from 'lucide-react'

const fabCls = 'fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-20 flex items-center gap-1.5 px-4 py-2 bg-sky-500/15 border border-sky-500/25 backdrop-blur-sm text-sky-600 dark:text-sky-300 text-sm font-medium rounded-full shadow-lg active:opacity-75 active:scale-[0.97] transition-[opacity,transform] duration-150'
const COMPOSER_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf'

interface PageShellProps {
  action?: { label: string; onPress: string | (() => void) }
  composer?: {
    placeholder: string
    onSubmit: (value: string, files?: File[]) => Promise<void>
    acceptAttachments?: boolean
  }
  onRefresh?: () => Promise<void>
  children: React.ReactNode
}

// The app uses a single document-level scroll container (see Shell +
// AppHeader). React Router's <ScrollRestoration /> handles back/forward
// natively. Pull-to-refresh reads window.scrollY.
export function PageShell({ action, composer, onRefresh, children }: PageShellProps) {
  const startY = useRef(0)
  const wasAtTop = useRef(false)
  const [refreshing, setRefreshing] = useState(false)
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!onRefresh) return
    const onTouchStart = (e: TouchEvent) => {
      startY.current = e.touches[0].clientY
      wasAtTop.current = window.scrollY <= 0
    }
    const onTouchEnd = async (e: TouchEvent) => {
      if (!wasAtTop.current) return
      const delta = e.changedTouches[0].clientY - startY.current
      if (delta > 70) {
        setRefreshing(true)
        try { await onRefresh() } finally { setRefreshing(false) }
      }
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend',   onTouchEnd,   { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend',   onTouchEnd)
    }
  }, [onRefresh])

  const hasAction = action || composer
  const showComposer = composer && composing

  async function handleComposerSubmit(e: React.FormEvent) {
    e.preventDefault()
    if ((!draft.trim() && files.length === 0) || !composer) return
    await composer.onSubmit(draft, files.length > 0 ? files : undefined)
    setDraft('')
    setFiles([])
    setComposing(false)
  }

  function closeComposer() {
    setComposing(false)
    setDraft('')
    setFiles([])
  }

  return (
    <div className={`relative px-4 pt-4 ${hasAction ? 'pb-16' : 'pb-4'}`}>
      {refreshing && (
        <div className="text-center py-2 text-xs text-zinc-500 dark:text-zinc-600">...</div>
      )}
      {children}

      {showComposer && <div className="fixed inset-0 z-10" onClick={closeComposer} />}

      {showComposer ? (
        <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 right-4 z-20 flex flex-col gap-2">
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1">
              {files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded-sm bg-white/90 dark:bg-zinc-900/90 border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 backdrop-blur-sm">
                  {f.name}
                  <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <form onSubmit={handleComposerSubmit} className="flex items-center gap-2 px-4 py-2 bg-sky-500/15 border border-sky-500/25 backdrop-blur-sm rounded-full shadow-lg">
            {composer.acceptAttachments && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={COMPOSER_ACCEPT}
                  onChange={e => {
                    if (!e.target.files) return
                    setFiles(prev => [...prev, ...Array.from(e.target.files!)])
                    e.target.value = ''
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="shrink-0 text-sky-500 hover:text-sky-400"
                  aria-label="attach file"
                >
                  <Paperclip size={16} />
                </button>
              </>
            )}
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={composer.placeholder}
              autoFocus
              className="bg-transparent text-base text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 dark:placeholder-zinc-500 outline-none flex-1 min-w-0"
            />
            <button type="submit" disabled={!draft.trim() && files.length === 0} className="text-sky-500 text-sm font-medium disabled:opacity-30">
              add
            </button>
          </form>
        </div>
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

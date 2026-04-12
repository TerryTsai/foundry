import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ChevronDown, Check, Plus, Settings } from 'lucide-react'
import { projectApi } from '../api.js'
import type { Project } from '../types.js'

interface Props {
  current:   Project | null
  projectId: string
  className?: string
}

interface Pos { top: number; left: number; width: number }

export function ProjectSwitcher({ current, projectId, className }: Props) {
  const [open,     setOpen]     = useState(false)
  const [pos,      setPos]      = useState<Pos | null>(null)
  const [projects, setProjects] = useState<Project[] | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  function handleOpen() {
    if (open) { setOpen(false); return }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) {
      // Calculate position while ensuring it stays within viewport bounds
      const minWidth = Math.max(rect.width, 200)
      const gap = 6
      const padding = 8 // padding from screen edge
      
      // Adjust horizontal position to prevent overflow on right edge
      let left = rect.left
      if (left + minWidth > window.innerWidth - padding) {
        left = Math.max(padding, window.innerWidth - minWidth - padding)
      }
      
      // Calculate vertical position and check for bottom overflow
      let top = rect.bottom + gap
      const maxHeight = window.innerHeight - top - padding
      
      // If not enough space below, position above if there's more room
      if (maxHeight < 150 && rect.top > window.innerHeight - rect.bottom) {
        top = rect.top - gap
      }
      
      setPos({ top, left, width: rect.width })
    }
    setOpen(true)
    // Lazy fetch on first open. Refetch on every open keeps the list fresh
    // without requiring eager loading in the Shell loader.
    projectApi.list().then(setProjects).catch(console.error)
  }

  function handleClose() {
    setOpen(false)
  }

  const dropdown = open && pos && createPortal(
    <>
      <div onClick={handleClose} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
      <div
        style={{ 
          position: 'fixed', 
          top: pos.top, 
          left: pos.left, 
          minWidth: Math.max(pos.width, 200),
          maxWidth: `calc(100vw - ${pos.left}px - 8px)`,
          maxHeight: `calc(100vh - ${pos.top}px - 8px)`,
          zIndex: 9999 
        }}
        className="bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700/60 rounded-lg shadow-xl overflow-auto py-1"
      >
        {projects === null ? (
          <div className="px-3 py-2 text-xs text-zinc-500">loading…</div>
        ) : projects.length === 0 ? (
          <div className="px-3 py-2 text-xs text-zinc-500">no projects</div>
        ) : (
          projects.map(p => {
            const isCurrent = p.id === projectId
            return (
              <Link
                key={p.id}
                to={`/p/${p.id}/tickets`}
                onClick={handleClose}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              >
                <Check size={12} strokeWidth={3} className={isCurrent ? 'text-amber-400' : 'text-transparent'} />
                <span className={isCurrent ? 'text-zinc-900 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400'}>{p.name}</span>
                {p.status === 'archived' && <span className="text-[10px] text-zinc-500 ml-auto">archived</span>}
              </Link>
            )
          })
        )}
        <div className="border-t border-zinc-200 dark:border-zinc-800 mt-1 pt-1">
          <Link
            to={`/settings/projects/${projectId}`}
            onClick={handleClose}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
          >
            <Settings size={12} strokeWidth={2} />
            Settings
          </Link>
          <Link
            to="/settings/projects/new"
            onClick={handleClose}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
          >
            <Plus size={12} strokeWidth={2} />
            New project…
          </Link>
        </div>
      </div>
    </>,
    document.body,
  )

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className={className ?? 'flex-1 flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-zinc-700 dark:text-zinc-300 truncate hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors'}
      >
        <span className="truncate">{current?.name ?? '...'}</span>
        <ChevronDown size={13} strokeWidth={2} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {dropdown}
    </>
  )
}

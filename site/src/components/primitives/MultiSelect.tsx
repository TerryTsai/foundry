import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'

interface MultiSelectProps {
  label: string
  options: string[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}

interface DropdownPos { top: number; left: number; width: number }

export function MultiSelect({ label, options, selected, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<DropdownPos | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  // Outside clicks are handled by the backdrop below — no document listener
  // needed, which avoids the race where mousedown closes the dropdown but the
  // subsequent click still hits a list item underneath.

  function handleOpen() {
    if (open) { setOpen(false); return }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) {
      // Calculate position while ensuring it stays within viewport bounds
      const minWidth = Math.max(rect.width, 140)
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
  }

  function toggle(value: string) {
    const next = new Set(selected)
    next.has(value) ? next.delete(value) : next.add(value)
    onChange(next)
  }

  const count = selected.size
  const active = count > 0

  const dropdown = open && pos && createPortal(
    <>
      <div
        onClick={() => setOpen(false)}
        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
      />
      <div
        id="multiselect-portal"
        style={{ 
          position: 'fixed', 
          top: pos.top, 
          left: pos.left, 
          minWidth: Math.max(pos.width, 140),
          maxWidth: `calc(100vw - ${pos.left}px - 8px)`,
          maxHeight: `calc(100vh - ${pos.top}px - 8px)`,
          zIndex: 9999 
        }}
        className="bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700/60 rounded-lg shadow-xl overflow-auto"
      >
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => toggle(opt)}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 active:bg-zinc-100 dark:active:bg-zinc-800/80 transition-colors"
        >
          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
            selected.has(opt) ? 'bg-zinc-500 border-zinc-500' : 'border-zinc-400 dark:border-zinc-600'
          }`}>
            {selected.has(opt) && <Check size={9} strokeWidth={3} className="text-white dark:text-zinc-900" />}
          </span>
          <span className={selected.has(opt) ? 'text-zinc-900 dark:text-zinc-200' : 'text-zinc-500 dark:text-zinc-400'}>{opt}</span>
        </button>
      ))}
      {active && (
        <>
          <div className="border-t border-zinc-200 dark:border-zinc-700 mx-2" />
          <button
            onClick={() => { onChange(new Set()); setOpen(false) }}
            className="w-full px-3 py-2 text-xs text-zinc-600 text-left hover:text-zinc-400 transition-colors"
          >
            clear
          </button>
        </>
      )}
      </div>
    </>,
    document.body
  )

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs transition-colors shrink-0 ${
          active
            ? 'border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-300'
            : 'border-transparent text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 active:bg-zinc-200 dark:active:bg-zinc-800'
        }`}
      >
        <span>{label}</span>
        {active && (
          <span className="bg-sky-500/30 text-sky-700 dark:text-sky-200 text-[10px] font-medium rounded-full w-4 h-4 flex items-center justify-center leading-none">
            {count}
          </span>
        )}
        <ChevronDown
          size={11}
          strokeWidth={2}
          className={`text-zinc-600 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {dropdown}
    </>
  )
}

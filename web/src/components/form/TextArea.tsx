import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { inputCls } from './TextInput.js'

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
}

export function TextArea({ label, onChange, value, ...props }: TextAreaProps) {
  const [expanded, setExpanded] = useState(false)
  const overlayRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (expanded) {
      // Wait for portal to mount, then focus and move cursor to end
      requestAnimationFrame(() => {
        const el = overlayRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      })
    }
  }, [expanded])

  const overlay = expanded && createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-zinc-950">
      <div className="shrink-0 flex items-center justify-between px-4 h-12 border-b border-zinc-800/60">
        <span className="text-sm text-zinc-400">{label ?? 'Edit'}</span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-sm font-medium text-sky-400 active:opacity-70 px-1"
        >
          Done
        </button>
      </div>
      <textarea
        ref={overlayRef}
        value={value}
        onChange={onChange}
        className="flex-1 bg-transparent text-zinc-200 text-[16px] px-4 py-3 resize-none focus:outline-none leading-relaxed"
        {...props}
        rows={undefined}
      />
    </div>,
    document.body
  )

  return (
    <>
      <div className="relative">
        <textarea
          value={value}
          onChange={onChange}
          onFocus={() => setExpanded(true)}
          className={`${inputCls} resize-none`}
          readOnly={expanded}
          {...props}
        />
      </div>
      {overlay}
    </>
  )
}

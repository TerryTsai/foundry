import { Field } from './Field.js'

interface ToolPickerProps {
  available: string[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}

export function ToolPicker({ available, selected, onChange }: ToolPickerProps) {
  if (available.length === 0) return null

  return (
    <Field label="tools">
      <div className="flex flex-wrap gap-1.5">
        {available.map(t => {
          const on = selected.has(t)
          return (
            <button
              key={t}
              type="button"
              onClick={() => {
                const next = new Set(selected)
                on ? next.delete(t) : next.add(t)
                onChange(next)
              }}
              className={`font-mono text-xs px-2.5 py-1 rounded-full border transition-colors ${
                on
                  ? 'border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-300'
                  : 'border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400'
              }`}
            >
              {t}
            </button>
          )
        })}
      </div>
      {selected.size === 0 && (
        <div className="text-[11px] text-zinc-500 dark:text-zinc-500 mt-1">all tools enabled when none selected</div>
      )}
    </Field>
  )
}

import { Check } from 'lucide-react'
import type { Agent } from '../../types.js'
import { Field } from './Field.js'

interface VerifierPickerProps {
  agents:   Agent[]        // candidate verifiers (caller filters self)
  selected: string[]       // agent ids
  onChange: (next: string[]) => void
}

export function VerifierPicker({ agents, selected, onChange }: VerifierPickerProps) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }
  return (
    <Field label="verifiers">
      {agents.length === 0 ? (
        <div className="text-xs text-zinc-500">no other agents available</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {agents.map(a => {
            const on = selected.includes(a.id)
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle(a.id)}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs transition-colors ${
                  on
                    ? 'border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-300'
                    : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                }`}
              >
                {on && <Check size={10} strokeWidth={3} />}
                <span>{a.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </Field>
  )
}

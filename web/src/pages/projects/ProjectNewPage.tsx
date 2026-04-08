import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { projectApi, agentApi } from '../../api.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { ActionButton } from '../../components/form/ActionButton.js'

const DEFAULT_AGENT_PROMPT = `You are a software engineering agent working on a codebase. You receive tickets describing tasks to implement.

When given a ticket:
1. Explore the codebase to understand the relevant code
2. Implement the changes described in the ticket
3. Run tests to verify your work
4. Commit your changes with a clear message

Use run_command to run shell commands (git, npm, tests, etc).
Use create_ticket to break large tasks into sub-tickets before starting work on them.

Always read existing code before modifying it. Write clean, minimal changes that match the existing style.`

export function ProjectNewPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [interval, setInterval] = useState('600')
  const [maxAgents, setMaxAgents] = useState('3')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const saved = await projectApi.create({ name, schedule_interval: +interval, concurrency_limit: +maxAgents })
      await agentApi.create({ project_id: saved.id, name: 'coder', model: 'anthropic:claude-sonnet-4-20250514', prompt: DEFAULT_AGENT_PROMPT })
      navigate(`/p/${saved.id}/tickets`)
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  return (
    <div className="h-dvh flex flex-col bg-white dark:bg-zinc-950">
      <div className="flex items-center gap-2.5 px-4 h-12 shrink-0 border-b border-zinc-200 dark:border-zinc-800/60">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">New Project</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 lg:px-6 py-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="text-sm text-red-400">{error}</div>}
            <Field label="name">
              <TextInput value={name} onChange={e => setName(e.target.value)} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="interval (s)">
                <TextInput type="number" value={interval} onChange={e => setInterval(e.target.value)} required min="10" />
              </Field>
              <Field label="max agents">
                <TextInput type="number" value={maxAgents} onChange={e => setMaxAgents(e.target.value)} required min="1" />
              </Field>
            </div>
            <div className="flex gap-2 pt-2">
              <ActionButton label="cancel" variant="secondary" onClick={() => navigate(-1)} className="flex-1" />
              <ActionButton label="create" type="submit" className="flex-1" />
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

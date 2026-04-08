import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { agentApi } from '../../api.js'
import { useShell } from '../../Shell.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { TextArea } from '../../components/form/TextArea.js'
import { ActionButton } from '../../components/form/ActionButton.js'

export function AgentNewPage() {
  const { projectId } = useShell()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [model, setModel] = useState('anthropic:claude-sonnet-4-20250514')
  const [prompt, setPrompt] = useState('')
  const [maxTokens, setMaxTokens] = useState('8192')
  const [maxSteps, setMaxSteps] = useState('20')
  const [temperature, setTemperature] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await agentApi.create({
        project_id: projectId, name, model, prompt,
        max_tokens: +maxTokens, max_steps: +maxSteps,
        temperature: temperature ? +temperature : undefined,
      })
      navigate(`/p/${projectId}/agents`)
    } catch (err) { setError(err instanceof Error ? err.message : 'failed') }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 lg:px-6 py-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="text-sm text-red-400">{error}</div>}
        <Field label="name">
          <TextInput value={name} onChange={e => setName(e.target.value)} required />
        </Field>
        <Field label="model">
          <TextInput value={model} onChange={e => setModel(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="max tokens">
            <TextInput type="number" value={maxTokens} onChange={e => setMaxTokens(e.target.value)} required min="1" />
          </Field>
          <Field label="max steps">
            <TextInput type="number" value={maxSteps} onChange={e => setMaxSteps(e.target.value)} required min="1" />
          </Field>
          <Field label="temperature">
            <TextInput type="number" value={temperature} onChange={e => setTemperature(e.target.value)} min="0" max="2" step="0.1" placeholder="default" />
          </Field>
        </div>
        <Field label="prompt">
          <TextArea label="prompt" value={prompt} onChange={e => setPrompt(e.target.value)} required rows={8} />
        </Field>
        <div className="flex gap-2 pt-2">
          <ActionButton label="cancel" variant="secondary" onClick={() => navigate(-1)} className="flex-1" />
          <ActionButton label="create" type="submit" className="flex-1" />
        </div>
      </form>
    </div>
  )
}

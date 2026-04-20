import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Paperclip, X } from 'lucide-react'
import { ticketApi, attachmentApi } from '../../api.js'
import { agentListOpts, qk } from '../../queries.js'
import { useShell } from '../../Shell.js'
import { Field } from '../../components/form/Field.js'
import { TextInput } from '../../components/form/TextInput.js'
import { TextArea } from '../../components/form/TextArea.js'
import { Select } from '../../components/form/Select.js'
import { ActionButton } from '../../components/form/ActionButton.js'

const ACCEPTED_MIME = 'image/png,image/jpeg,image/webp,image/gif,application/pdf'

export function TicketNewPage() {
  const { projectId } = useShell()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: agents = [] } = useQuery(agentListOpts())
  const [agentId, setAgentId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Create first, then upload each attachment to the new ticket id.
  // Upload failures don't block the create — they surface as toasts.
  const createMutation = useMutation({
    mutationFn: async () => {
      const ticket = await ticketApi.create({
        project_id: projectId, title, description,
        agent_id: agentId || undefined, created_by: 'founder',
      })
      for (const file of files) {
        try { await attachmentApi.upload(ticket.id, file) }
        catch (err) { console.warn('attachment upload failed:', err) }
      }
      return ticket
    },
    onSuccess: ticket => {
      queryClient.invalidateQueries({ queryKey: qk.ticket.all() })
      navigate(`/p/${projectId}/tickets/${ticket.id}`)
    },
    onError: err => setError(err instanceof Error ? err.message : 'failed'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    createMutation.mutate()
  }

  function handleFilesPicked(picked: FileList | null) {
    if (!picked) return
    setFiles(prev => [...prev, ...Array.from(picked)])
  }

  return (
    <div className="px-4 py-5 lg:max-w-2xl lg:mx-auto lg:px-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="text-sm text-red-400">{error}</div>}
        <Field label="agent">
          <Select value={agentId} onChange={e => setAgentId(e.target.value)}>
            <option value="">unassigned</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="title">
          <TextInput value={title} onChange={e => setTitle(e.target.value)} required />
        </Field>
        <Field label="description">
          <TextArea label="description" value={description} onChange={e => setDescription(e.target.value)} required rows={5} />
        </Field>

        <Field label="attachments">
          <div className="space-y-2">
            {files.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {files.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded-sm border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400">
                    {f.name} <span className="text-zinc-400 dark:text-zinc-600">{(f.size / 1024).toFixed(0)} KB</span>
                    <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_MIME}
              onChange={e => handleFilesPicked(e.target.files)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-sm px-2 py-1"
            >
              <Paperclip size={12} /> add file (png, jpg, webp, gif, pdf — 10 MB max)
            </button>
          </div>
        </Field>

        <div className="flex gap-2 pt-2">
          <ActionButton label="cancel" variant="secondary" onClick={() => navigate(-1)} className="flex-1" />
          <ActionButton
            label={createMutation.isPending ? 'creating…' : 'create'}
            type="submit"
            disabled={createMutation.isPending}
            className="flex-1"
          />
        </div>
      </form>
    </div>
  )
}

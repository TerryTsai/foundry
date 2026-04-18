import { useState } from 'react'
import { marked } from 'marked'
import { PageShell } from './PageShell.js'
import { DetailHeader } from '../detail/DetailHeader.js'
import { InfoGroup } from '../detail/InfoGroup.js'

interface InfoRow {
  label: string
  value: React.ReactNode
  href?: string
}

interface DetailShellProps {
  type: string
  id?: string
  title: string
  subtitle?: string
  subtitleAside?: React.ReactNode
  status?: string
  mono?: boolean
  actions?: React.ReactNode
  infoRows: InfoRow[]
  primaryCount?: number
  composer?: { placeholder: string; onSubmit: (value: string) => Promise<void> }
  backLink?: React.ReactNode
  children?: React.ReactNode
}

export function DetailShell({
  type, id, title, subtitle, subtitleAside, status, mono, actions,
  infoRows, primaryCount = 4,
  composer, backLink, children,
}: DetailShellProps) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    if (!id) return
    const ta = document.createElement('textarea')
    ta.value = id
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const copyId = id ? (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 font-mono text-xs leading-5 text-amber-500 dark:text-amber-400 active:opacity-60 select-none"
    >
      {id}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
      </svg>
      {copied && <span className="text-emerald-500 text-[10px]">copied</span>}
    </button>
  ) : null
  const allRows = id ? [{ label: 'id', value: copyId }, ...infoRows] : infoRows

  return (
    <PageShell composer={composer}>
      <div className="max-w-2xl mx-auto lg:px-2 py-5 space-y-3">
        {backLink}
        <DetailHeader type={type} title={title} status={status} mono={mono} actions={actions} />
        <InfoGroup rows={allRows} primaryCount={primaryCount} />
        {(subtitle || subtitleAside) && (
          <div className="space-y-3">
            {subtitle && (
              <div
                className="prose-zinc text-sm text-zinc-700 dark:text-zinc-400 max-w-full overflow-x-auto"
                dangerouslySetInnerHTML={{ __html: marked.parse(subtitle) as string }}
              />
            )}
            {subtitleAside}
          </div>
        )}
        <div className="space-y-4">
          {children}
        </div>
      </div>
    </PageShell>
  )
}

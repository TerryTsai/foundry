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
  status?: string
  mono?: boolean
  actions?: React.ReactNode
  infoRows: InfoRow[]
  primaryCount?: number
  composer?: { placeholder: string; onSubmit: (value: string) => Promise<void> }
  children?: React.ReactNode
}

export function DetailShell({
  type, id, title, subtitle, status, mono, actions,
  infoRows, primaryCount = 4,
  composer, children,
}: DetailShellProps) {
  const copyId = id ? (
    <button
      onClick={() => navigator.clipboard.writeText(id)}
      className="inline-flex items-center gap-1.5 font-mono text-xs leading-5 text-amber-500 dark:text-amber-400 active:opacity-60"
    >
      {id}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
      </svg>
    </button>
  ) : null
  const allRows = id ? [{ label: 'id', value: copyId }, ...infoRows] : infoRows

  return (
    <PageShell composer={composer}>
      <div className="max-w-2xl mx-auto lg:px-2 py-5 space-y-4">
        <DetailHeader type={type} title={title} subtitle={subtitle} status={status} mono={mono} actions={actions} />
        <InfoGroup rows={allRows} primaryCount={primaryCount} />
        <div className="px-4 space-y-4">
          {children}
        </div>
      </div>
    </PageShell>
  )
}

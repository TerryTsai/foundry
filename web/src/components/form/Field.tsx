// Match bare URLs (http/https) or host-style tokens like dash.cloudflare.com/...
// We keep the regex deliberately simple — help text is author-controlled.
const URL_RE = /(\bhttps?:\/\/[^\s)]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?)/gi

function linkify(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  URL_RE.lastIndex = 0
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const raw  = m[0]
    const href = raw.startsWith('http') ? raw : `https://${raw}`
    out.push(
      <a key={m.index} href={href} target="_blank" rel="noopener noreferrer"
         className="underline decoration-dotted hover:text-zinc-400">{raw}</a>
    )
    last = m.index + raw.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Field({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-500">{label}</label>
      {children}
      {help && <p className="text-xs text-zinc-500 dark:text-zinc-600">{linkify(help)}</p>}
    </div>
  )
}

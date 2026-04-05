import { useState, useEffect } from 'react'
import { repoApi } from '../api.js'
import { EmptyState } from '../components/list/EmptyState.js'

export function RepoView({ projectSlug }: { projectSlug: string }) {
  const [files, setFiles] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState('')
  const [content, setContent] = useState('')
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [loadingContent, setLoadingContent] = useState(false)

  useEffect(() => {
    setLoadingFiles(true)
    repoApi.listFiles(projectSlug)
      .then(f => { setFiles(f); setContent(''); setSelectedFile('') })
      .catch(() => setFiles([]))
      .finally(() => setLoadingFiles(false))
  }, [projectSlug])

  function handleFileClick(path: string) {
    setSelectedFile(path)
    setLoadingContent(true)
    repoApi.readFile(projectSlug, path)
      .then(setContent)
      .catch(() => setContent('(error reading file)'))
      .finally(() => setLoadingContent(false))
  }

  function lang(path: string): string {
    const ext = path.split('.').pop() ?? ''
    const map: Record<string, string> = { ts: 'typescript', tsx: 'tsx', js: 'js', md: 'markdown', json: 'json', sh: 'bash' }
    return map[ext] ?? ''
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-2 shrink-0 flex items-baseline justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-zinc-100 tracking-tight">Repo</h1>
        {selectedFile && (
          <span className="font-mono text-[10px] text-zinc-600 truncate max-w-[50%] text-right">
            {selectedFile}
            {lang(selectedFile) && <span className="text-zinc-700"> · {lang(selectedFile)}</span>}
          </span>
        )}
      </div>

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        <div className={`shrink-0 border-b md:border-b-0 md:border-r border-zinc-800 overflow-y-auto ${selectedFile ? 'h-36 md:h-auto md:w-48' : 'flex-1 md:flex-none md:w-48'}`}>
          {loadingFiles ? (
            <EmptyState message="loading…" />
          ) : files.length === 0 ? (
            <EmptyState message="no files" />
          ) : files.map(f => (
            <button key={f} onClick={() => handleFileClick(f)}
              className={`w-full text-left px-3 py-2 font-mono text-xs truncate transition-colors border-b border-zinc-900 ${
                selectedFile === f
                  ? 'bg-zinc-100 text-zinc-900'
                  : 'text-zinc-400 active:bg-zinc-900/50'
              }`}>
              {f}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto bg-zinc-900 p-4 min-h-0">
          {loadingContent ? (
            <EmptyState message="loading…" />
          ) : selectedFile ? (
            <pre className="font-mono text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{content}</pre>
          ) : (
            <EmptyState message="select a file" />
          )}
        </div>
      </div>
    </div>
  )
}

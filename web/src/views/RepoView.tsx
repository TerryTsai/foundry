import { useState, useEffect } from 'react'
import { repoApi, projectApi } from '../api.js'
import type { Project } from '../types.js'

export function RepoView() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedSlug, setSelectedSlug] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState('')
  const [content, setContent] = useState('')
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [loadingContent, setLoadingContent] = useState(false)

  useEffect(() => {
    projectApi.list().then(setProjects).catch(console.error)
  }, [])

  useEffect(() => {
    if (!selectedSlug) { setFiles([]); setContent(''); setSelectedFile(''); return }
    setLoadingFiles(true)
    repoApi.listFiles(selectedSlug)
      .then(f => { setFiles(f); setContent(''); setSelectedFile('') })
      .catch(() => setFiles([]))
      .finally(() => setLoadingFiles(false))
  }, [selectedSlug])

  function handleFileClick(path: string) {
    setSelectedFile(path)
    setLoadingContent(true)
    repoApi.readFile(selectedSlug, path)
      .then(setContent)
      .catch(() => setContent('(error reading file)'))
      .finally(() => setLoadingContent(false))
  }

  // Simple extension-based language hint for display
  function lang(path: string): string {
    const ext = path.split('.').pop() ?? ''
    const map: Record<string, string> = { ts: 'typescript', tsx: 'tsx', js: 'js', md: 'markdown', json: 'json', sh: 'bash' }
    return map[ext] ?? ''
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
        <select value={selectedSlug} onChange={e => setSelectedSlug(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 text-zinc-300 font-mono text-base rounded-lg px-3 py-2 w-full">
          <option value="">select project</option>
          {projects.map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
        </select>
      </div>

      {/* Mobile: stacked (file list then content). md+: side-by-side */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* File tree */}
        <div className={`shrink-0 border-b md:border-b-0 md:border-r border-zinc-800 overflow-y-auto ${selectedFile ? 'h-36 md:h-auto md:w-48' : 'flex-1 md:flex-none md:w-48'}`}>
          {loadingFiles ? (
            <div className="p-3 font-mono text-xs text-zinc-500">loading…</div>
          ) : files.length === 0 && selectedSlug ? (
            <div className="p-3 font-mono text-xs text-zinc-600">no files</div>
          ) : files.map(f => (
            <button
              key={f}
              onClick={() => handleFileClick(f)}
              className={`w-full text-left px-3 py-2.5 font-mono text-xs truncate transition-colors ${
                selectedFile === f ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 active:text-zinc-200 active:bg-zinc-900/50'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* File content */}
        <div className="flex-1 overflow-auto bg-zinc-950 p-4 min-h-0">
          {loadingContent ? (
            <div className="font-mono text-xs text-zinc-500">loading…</div>
          ) : selectedFile ? (
            <div>
              <div className="font-mono text-xs text-zinc-500 mb-3 break-all">{selectedFile} {lang(selectedFile) && <span className="text-zinc-600">· {lang(selectedFile)}</span>}</div>
              <pre className="font-mono text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{content}</pre>
            </div>
          ) : (
            <div className="font-mono text-xs text-zinc-600">{selectedSlug ? 'select a file' : 'select a project'}</div>
          )}
        </div>
      </div>
    </div>
  )
}

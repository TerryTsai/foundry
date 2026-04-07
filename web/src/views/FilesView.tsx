import { useState, useEffect } from 'react'
import type { LucideProps } from 'lucide-react'
import {
  File, FileCode, FileCode2, FileJson, FileText, FileTerminal,
  FileCog, FileBraces, FileType, FileKey, FileLock, FileImage,
  FileArchive, FileSpreadsheet, Folder, FolderOpen, ChevronRight,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react'
import hljs from 'highlight.js/lib/core'
import { marked } from 'marked'
import { fileApi } from '../api.js'
import { EmptyState } from '../components/list/EmptyState.js'

// ── Syntax highlighting ──────────────────────────────────────────────────────

type LangLoader = () => Promise<{ default: object }>

const LANG_LOADERS: Record<string, { hljsName: string; loader: LangLoader }> = {
  ts:    { hljsName: 'typescript', loader: () => import('highlight.js/lib/languages/typescript') },
  tsx:   { hljsName: 'typescript', loader: () => import('highlight.js/lib/languages/typescript') },
  js:    { hljsName: 'javascript', loader: () => import('highlight.js/lib/languages/javascript')  },
  jsx:   { hljsName: 'javascript', loader: () => import('highlight.js/lib/languages/javascript')  },
  mjs:   { hljsName: 'javascript', loader: () => import('highlight.js/lib/languages/javascript')  },
  py:    { hljsName: 'python',     loader: () => import('highlight.js/lib/languages/python')      },
  json:  { hljsName: 'json',       loader: () => import('highlight.js/lib/languages/json')        },
  md:    { hljsName: 'markdown',   loader: () => import('highlight.js/lib/languages/markdown')    },
  sh:    { hljsName: 'bash',       loader: () => import('highlight.js/lib/languages/bash')        },
  bash:  { hljsName: 'bash',       loader: () => import('highlight.js/lib/languages/bash')        },
  yml:   { hljsName: 'yaml',       loader: () => import('highlight.js/lib/languages/yaml')        },
  yaml:  { hljsName: 'yaml',       loader: () => import('highlight.js/lib/languages/yaml')        },
  css:   { hljsName: 'css',        loader: () => import('highlight.js/lib/languages/css')         },
  html:  { hljsName: 'xml',        loader: () => import('highlight.js/lib/languages/xml')         },
  sql:   { hljsName: 'sql',        loader: () => import('highlight.js/lib/languages/sql')         },
  go:    { hljsName: 'go',         loader: () => import('highlight.js/lib/languages/go')          },
  rs:    { hljsName: 'rust',       loader: () => import('highlight.js/lib/languages/rust')        },
  toml:  { hljsName: 'ini',        loader: () => import('highlight.js/lib/languages/ini')         },
}

const registered = new Set<string>()

async function highlight(code: string, ext: string): Promise<string | null> {
  const entry = LANG_LOADERS[ext]
  if (!entry) return null
  const { hljsName, loader } = entry
  if (!registered.has(hljsName)) {
    const mod = await loader()
    hljs.registerLanguage(hljsName, (mod as { default: Parameters<typeof hljs.registerLanguage>[1] }).default)
    registered.add(hljsName)
  }
  return hljs.highlight(code, { language: hljsName }).value
}

// ── Tree building ────────────────────────────────────────────────────────────

type TreeFile = { kind: 'file'; name: string; path: string }
type TreeDir  = { kind: 'dir';  name: string; children: TreeNode[] }
type TreeNode = TreeFile | TreeDir

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeDir = { kind: 'dir', name: '', children: [] }
  for (const path of paths) {
    const parts = path.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (i === parts.length - 1) {
        node.children.push({ kind: 'file', name: part, path })
      } else {
        let dir = node.children.find((c): c is TreeDir => c.kind === 'dir' && c.name === part)
        if (!dir) { dir = { kind: 'dir', name: part, children: [] }; node.children.push(dir) }
        node = dir
      }
    }
  }
  function sort(nodes: TreeNode[]): TreeNode[] {
    return nodes
      .sort((a, b) => a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name))
      .map(n => n.kind === 'dir' ? { ...n, children: sort(n.children) } : n)
  }
  return sort(root.children)
}

// ── Lang / icon detection ────────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', js: 'js', mjs: 'js',
  json: 'json', md: 'md', sh: 'sh', yml: 'yaml', yaml: 'yaml',
  py: 'py', css: 'css', html: 'html', sql: 'sql',
}

function fileLang(path: string) {
  return EXT_LANG[path.split('.').pop() ?? ''] ?? ''
}

type IconComponent = React.ComponentType<LucideProps>
type FileIconSpec  = { icon: IconComponent; color: string }

function getFileIcon(name: string): FileIconSpec {
  const lower = name.toLowerCase()
  const ext   = lower.split('.').pop() ?? ''

  if (lower === '.env' || lower.startsWith('.env.'))              return { icon: FileKey,        color: 'text-yellow-500' }
  if (lower === 'package.json')                                   return { icon: FileJson,        color: 'text-amber-400'  }
  if (lower === 'package-lock.json')                              return { icon: FileLock,        color: 'text-zinc-500'   }
  if (lower === 'yarn.lock' || lower === 'pnpm-lock.yaml')        return { icon: FileLock,        color: 'text-zinc-500'   }
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.'))  return { icon: FileCog,         color: 'text-sky-400'    }
  if (lower === 'makefile')                                       return { icon: FileTerminal,    color: 'text-green-400'  }
  if (lower === 'readme.md' || lower === 'readme')                return { icon: FileText,        color: 'text-zinc-300'   }

  const map: Record<string, FileIconSpec> = {
    ts:    { icon: FileCode,        color: 'text-blue-400'   },
    tsx:   { icon: FileCode,        color: 'text-cyan-400'   },
    js:    { icon: FileCode2,       color: 'text-yellow-400' },
    jsx:   { icon: FileCode2,       color: 'text-yellow-400' },
    mjs:   { icon: FileCode2,       color: 'text-yellow-400' },
    cjs:   { icon: FileCode2,       color: 'text-yellow-400' },
    py:    { icon: FileCode,        color: 'text-sky-400'    },
    go:    { icon: FileCode,        color: 'text-cyan-300'   },
    rs:    { icon: FileCode,        color: 'text-orange-400' },
    json:  { icon: FileJson,        color: 'text-amber-400'  },
    md:    { icon: FileText,        color: 'text-zinc-400'   },
    mdx:   { icon: FileText,        color: 'text-zinc-400'   },
    txt:   { icon: FileText,        color: 'text-zinc-500'   },
    sh:    { icon: FileTerminal,    color: 'text-green-400'  },
    bash:  { icon: FileTerminal,    color: 'text-green-400'  },
    zsh:   { icon: FileTerminal,    color: 'text-green-400'  },
    yml:   { icon: FileCog,         color: 'text-rose-400'   },
    yaml:  { icon: FileCog,         color: 'text-rose-400'   },
    toml:  { icon: FileCog,         color: 'text-rose-300'   },
    css:   { icon: FileType,        color: 'text-violet-400' },
    scss:  { icon: FileType,        color: 'text-pink-400'   },
    html:  { icon: FileBraces,      color: 'text-orange-400' },
    sql:   { icon: FileSpreadsheet, color: 'text-teal-400'   },
    png:   { icon: FileImage,       color: 'text-pink-300'   },
    jpg:   { icon: FileImage,       color: 'text-pink-300'   },
    jpeg:  { icon: FileImage,       color: 'text-pink-300'   },
    svg:   { icon: FileImage,       color: 'text-pink-300'   },
    webp:  { icon: FileImage,       color: 'text-pink-300'   },
    zip:   { icon: FileArchive,     color: 'text-zinc-400'   },
    gz:    { icon: FileArchive,     color: 'text-zinc-400'   },
  }

  return map[ext] ?? { icon: File, color: 'text-zinc-600' }
}

// ── Tree node component ──────────────────────────────────────────────────────

function TreeNodeRow({
  node, depth, selectedFile, onFileClick,
}: {
  node: TreeNode; depth: number; selectedFile: string; onFileClick: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const indent = depth * 12

  if (node.kind === 'file') {
    const active = selectedFile === node.path
    const { icon: Icon, color } = getFileIcon(node.name)
    return (
      <button
        onClick={() => onFileClick(node.path)}
        className={`w-full text-left flex items-center gap-1.5 py-1 pr-3 transition-colors ${
          active ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-500 active:text-zinc-700 dark:active:text-zinc-300'
        }`}
        style={{ paddingLeft: `${12 + indent}px` }}
      >
        {active && <span className="absolute left-0 w-0.5 h-4 bg-zinc-400 dark:bg-zinc-400 rounded-full" />}
        <Icon size={12} strokeWidth={1.5} className={`shrink-0 ${active ? color : 'text-zinc-300 dark:text-zinc-600'}`} />
        <span className="font-mono text-xs truncate">{node.name}</span>
      </button>
    )
  }

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left flex items-center gap-1.5 py-1 pr-3 text-zinc-500 dark:text-zinc-400 active:text-zinc-700 dark:active:text-zinc-200 transition-colors"
        style={{ paddingLeft: `${indent}px` }}
      >
        <ChevronRight
          size={11} strokeWidth={2}
          className={`shrink-0 text-zinc-300 dark:text-zinc-600 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        {open
          ? <FolderOpen size={12} strokeWidth={1.5} className="text-zinc-400 dark:text-zinc-500 shrink-0" />
          : <Folder     size={12} strokeWidth={1.5} className="text-zinc-300 dark:text-zinc-600 shrink-0" />
        }
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{node.name}</span>
      </button>
      {open && node.children.map((child, i) => (
        <div key={i} className="relative">
          <TreeNodeRow node={child} depth={depth + 1} selectedFile={selectedFile} onFileClick={onFileClick} />
        </div>
      ))}
    </div>
  )
}

// ── View ─────────────────────────────────────────────────────────────────────

export function FilesView({ projectId }: { projectId: string }) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [selectedFile, setSelectedFile] = useState('')
  const [rendered, setRendered] = useState<{ html: string; mode: 'code' | 'markdown' } | null>(null)
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [loadingContent, setLoadingContent] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    setLoadingFiles(true)
    fileApi.listFiles(projectId)
      .then(f => { setTree(buildTree(f)); setRendered(null); setSelectedFile('') })
      .catch(() => setTree([]))
      .finally(() => setLoadingFiles(false))
  }, [projectId])

  async function handleFileClick(path: string) {
    setSelectedFile(path)
    setRendered(null)
    setLoadingContent(true)
    // Close sidebar on mobile only — on desktop it stays visible via CSS
    if (window.innerWidth < 1024) setSidebarOpen(false)
    try {
      const raw = await fileApi.readFile(projectId, path)
      const ext = path.split('.').pop() ?? ''
      if (ext === 'md' || ext === 'mdx') {
        const html = await marked(raw, { async: true })
        setRendered({ html, mode: 'markdown' })
      } else {
        const html = await highlight(raw, ext)
        setRendered({ html: html ?? raw, mode: 'code' })
      }
    } catch {
      setRendered({ html: '(error reading file)', mode: 'code' })
    } finally {
      setLoadingContent(false)
    }
  }

  const lang = fileLang(selectedFile)
  const fileName = selectedFile.split('/').pop() ?? ''
  const fileDir  = selectedFile.includes('/')
    ? selectedFile.split('/').slice(0, -1).join('/') + '/'
    : ''

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800/60 h-11 flex items-center gap-2 min-w-0">
        <button
          onClick={() => setSidebarOpen(o => !o)}
          className="shrink-0 h-full px-3 flex items-center text-zinc-400 dark:text-zinc-600 active:text-zinc-700 dark:active:text-zinc-300 transition-colors border-r border-zinc-200 dark:border-zinc-800/60 lg:hidden"
          title={sidebarOpen ? 'hide sidebar' : 'show sidebar'}
        >
          {sidebarOpen
            ? <PanelLeftClose size={14} strokeWidth={1.5} />
            : <PanelLeftOpen  size={14} strokeWidth={1.5} />
          }
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0 pr-4">
          {selectedFile ? (
            <>
              {fileDir && (
                <>
                  <span className="font-mono text-xs text-zinc-400 dark:text-zinc-600 truncate hidden sm:block">{fileDir}</span>
                  <ChevronRight size={10} className="text-zinc-400 dark:text-zinc-700 shrink-0 hidden sm:block" />
                </>
              )}
              <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 truncate">{fileName}</span>
              {lang && (
                <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-500 dark:text-zinc-600 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-1.5 py-0.5 rounded">
                  {lang}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-zinc-400 dark:text-zinc-600">files</span>
          )}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden lg:flex lg:flex-row">

        {/* Sidebar — desktop: always visible inline; mobile: overlay drawer */}
        <div className={`absolute top-0 left-0 bottom-0 z-20 w-56 bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800/60 overflow-y-auto py-2 shadow-xl lg:relative lg:z-0 lg:shadow-none lg:w-64 lg:shrink-0 lg:block ${sidebarOpen ? '' : 'hidden lg:block'}`}>
          {loadingFiles ? (
            <EmptyState message="loading…" />
          ) : tree.length === 0 ? (
            <EmptyState message="no files" />
          ) : tree.map((node, i) => (
            <div key={i} className="relative">
              <TreeNodeRow node={node} depth={0} selectedFile={selectedFile} onFileClick={handleFileClick} />
            </div>
          ))}
        </div>

        {/* Backdrop — mobile only */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 z-10 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Content */}
        <div className="absolute inset-0 overflow-auto bg-zinc-50 dark:bg-zinc-950 lg:relative lg:flex-1">
          {/* Loading bar */}
          {loadingContent && (
            <div className="absolute top-0 left-0 right-0 h-px bg-zinc-200 dark:bg-zinc-800 overflow-hidden z-10">
              <div
                className="h-full bg-sky-400 w-1/2"
                style={{ animation: 'loadbar 1.1s ease-in-out infinite' }}
              />
            </div>
          )}

          {!loadingContent && rendered && (
            rendered.mode === 'markdown' ? (
              <div
                className="prose-zinc p-6 max-w-3xl select-text"
                dangerouslySetInnerHTML={{ __html: rendered.html }}
              />
            ) : (
              <pre className="font-mono text-xs leading-relaxed p-5 hljs-zinc min-h-full select-text cursor-text">
                <code dangerouslySetInnerHTML={{ __html: rendered.html }} />
              </pre>
            )
          )}
          {!loadingContent && !rendered && (
            <EmptyState message="select a file" />
          )}
        </div>
      </div>
    </div>
  )
}

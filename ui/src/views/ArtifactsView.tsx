import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import type { Artifact } from "../types";
import { FilterBar } from "../components/FilterBar";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const TYPE_COLOR: Record<string, string> = {
  "git-bundle": "bg-accent-purple/20 text-accent-purple border-accent-purple/30",
  "code-snapshot": "bg-accent-purple/20 text-accent-purple border-accent-purple/30",
  "account-state": "bg-accent-blue/20 text-accent-blue border-accent-blue/30",
  "generated-content": "bg-pink-500/20 text-pink-300 border-pink-500/30",
  "environment-snapshot": "bg-accent-green/20 text-accent-green border-accent-green/30",
  "deployed-config": "bg-accent-amber/20 text-accent-amber border-accent-amber/30",
  "build-output": "bg-teal-500/20 text-teal-300 border-teal-500/30",
};

const TEXT_TYPES = new Set([
  "generated-content",
  "deployed-config",
  "environment-snapshot",
  "account-state",
]);

const PREVIEW_LIMIT = 5120; // 5KB

interface ArtifactContentProps {
  artifact: Artifact;
}

function ArtifactContent({ artifact }: ArtifactContentProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isText = TEXT_TYPES.has(artifact.type) || artifact.contentSize < 50_000;

  useEffect(() => {
    if (!isText) return;
    setLoading(true);
    api.artifacts
      .content(artifact.id)
      .then((c) => {
        setContent(c);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [artifact.id, isText]);

  if (!isText) {
    return (
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
        <span className="text-xs font-mono text-text-dim">binary content · {formatBytes(artifact.contentSize)}</span>
        <a
          href={`/api/artifacts/${artifact.id}/download`}
          download={artifact.name}
          className="text-xs font-mono text-accent-blue"
        >
          download
        </a>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mt-3 pt-3 border-t border-border/50 text-xs font-mono text-text-dim">
        loading content…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-3 pt-3 border-t border-border/50 text-xs font-mono text-accent-red">
        {error}
      </div>
    );
  }

  if (!content) return null;

  const displayed = showAll ? content : content.slice(0, PREVIEW_LIMIT);
  const truncated = content.length > PREVIEW_LIMIT && !showAll;

  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-all bg-surface-3 rounded-lg p-3 overflow-hidden">
        {displayed}
        {truncated && "…"}
      </pre>
      {truncated && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-2 text-xs font-mono text-accent-blue hover:text-accent-blue/80"
        >
          load more ({formatBytes(content.length - PREVIEW_LIMIT)} more)
        </button>
      )}
    </div>
  );
}

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const [expanded, setExpanded] = useState(false);
  const typeColors = TYPE_COLOR[artifact.type] ?? "bg-white/10 text-white/60 border-white/20";

  return (
    <div className="bg-surface-2 rounded-xl border border-border overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left p-4 hover:bg-surface-3/50 transition-colors"
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border flex-shrink-0 ${typeColors}`}
          >
            {artifact.type}
          </span>
          <span className="text-xs font-mono text-text-dim flex-shrink-0">{timeAgo(artifact.createdAt)}</span>
        </div>

        <p className="font-syne font-medium text-sm text-text-primary mb-1">{artifact.name}</p>

        {artifact.description && (
          <p className="text-xs text-text-secondary">{artifact.description}</p>
        )}

        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <span className="text-xs font-mono text-text-dim">{formatBytes(artifact.contentSize)}</span>
          <span className="text-xs font-mono text-text-dim">by {artifact.createdBy}</span>
          {artifact.taskId && (
            <span className="text-xs font-mono text-text-dim truncate max-w-[120px]">
              task: {artifact.taskId.slice(0, 8)}…
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-0">
          <ArtifactContent artifact={artifact} />
          <div className="flex justify-end mt-2">
            <a
              href={`/api/artifacts/${artifact.id}/download`}
              download={artifact.name}
              onClick={(e) => e.stopPropagation()}
              className="text-xs font-mono text-accent-blue"
            >
              download
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export function ArtifactsView() {
  const { projectId } = useParams<{ projectId: string }>();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [snapshotting, setSnapshotting] = useState(false);

  const loadArtifacts = useCallback(() => {
    if (!projectId) return;
    api.artifacts
      .list(projectId)
      .then((a) => {
        setArtifacts([...a].reverse());
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts]);

  async function triggerSnapshot() {
    const repoPath = prompt("Git repository path to snapshot:");
    if (!repoPath) return;
    setSnapshotting(true);
    try {
      const artifact = await api.artifacts.snapshot(projectId!, repoPath);
      setArtifacts((prev) => [artifact, ...prev]);
    } catch (err) {
      alert(`Snapshot failed: ${err}`);
    } finally {
      setSnapshotting(false);
    }
  }

  // Build filter options from data
  const types = Array.from(new Set(artifacts.map((a) => a.type))).sort();
  const agents = Array.from(new Set(artifacts.map((a) => a.createdBy))).sort();

  const filterOptions = [
    { value: "all", label: "All" },
    ...types.map((t) => ({ value: `type:${t}`, label: t })),
    ...agents.map((a) => ({ value: `agent:${a}`, label: `by ${a}` })),
  ];

  const filtered = artifacts.filter((a) => {
    if (filter === "all") return true;
    if (filter.startsWith("type:")) return a.type === filter.slice(5);
    if (filter.startsWith("agent:")) return a.createdBy === filter.slice(6);
    return true;
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Filter + snapshot button row */}
      <div className="flex-shrink-0 flex items-center gap-2 pr-4">
        <div className="flex-1 overflow-hidden">
          <FilterBar options={filterOptions} value={filter} onChange={setFilter} />
        </div>
        <button
          onClick={() => void triggerSnapshot()}
          disabled={snapshotting}
          className="flex-shrink-0 text-xs font-mono text-accent-blue px-3 py-1.5 rounded-lg border border-accent-blue/30 bg-accent-blue/10 hover:bg-accent-blue/20 transition-colors disabled:opacity-40 min-h-[36px]"
        >
          {snapshotting ? "…" : "Snapshot"}
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-text-dim font-mono text-sm">
            loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <p className="text-text-dim font-mono text-sm">
              {filter === "all" ? "No artifacts yet." : `No ${filter} artifacts.`}
            </p>
            {filter === "all" && (
              <p className="text-xs text-text-dim">Snapshots appear here after deployments.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2 pt-2">
            {filtered.map((a) => (
              <ArtifactCard key={a.id} artifact={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

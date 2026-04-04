import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import type { Artifact } from "../types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const TYPE_COLOR: Record<string, string> = {
  "git-bundle": "bg-purple-500/20 text-purple-300 border-purple-500/30",
  "code-snapshot": "bg-purple-500/20 text-purple-300 border-purple-500/30",
  "account-state": "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "generated-content": "bg-pink-500/20 text-pink-300 border-pink-500/30",
  "environment-snapshot": "bg-green-500/20 text-green-300 border-green-500/30",
  "deployed-config": "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "build-output": "bg-teal-500/20 text-teal-300 border-teal-500/30",
};

export function ArtifactsView() {
  const { projectId } = useParams<{ projectId: string }>();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshotting, setSnapshotting] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    api.artifacts
      .list(projectId)
      .then((a) => {
        setArtifacts([...a].reverse());
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId]);

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

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-mono text-text-dim uppercase tracking-wider">Artifacts</p>
        <button
          onClick={triggerSnapshot}
          disabled={snapshotting}
          className="text-xs font-mono text-accent-blue px-3 py-1.5 rounded-lg border border-accent-blue/30 bg-accent-blue/10 hover:bg-accent-blue/20 transition-colors disabled:opacity-40"
        >
          {snapshotting ? "…" : "Snapshot"}
        </button>
      </div>

      {loading ? (
        <div className="text-text-dim font-mono text-sm">loading…</div>
      ) : artifacts.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-text-dim font-mono text-sm">No artifacts yet.</p>
          <p className="text-xs text-text-dim mt-2">Snapshots appear here after deployments.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {artifacts.map((a) => (
            <ArtifactCard key={a.id} artifact={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const typeColors = TYPE_COLOR[artifact.type] ?? "bg-white/10 text-white/60 border-white/20";

  return (
    <div className="bg-surface-2 rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border flex-shrink-0 ${typeColors}`}>
          {artifact.type}
        </span>
        <span className="text-xs font-mono text-text-dim">{timeAgo(artifact.createdAt)}</span>
      </div>

      <p className="font-syne font-medium text-sm text-text-primary mb-1">{artifact.name}</p>

      {artifact.description && (
        <p className="text-xs text-text-secondary mb-2">{artifact.description}</p>
      )}

      <div className="flex items-center gap-3 mt-2">
        <span className="text-xs font-mono text-text-dim">{formatBytes(artifact.contentSize)}</span>
        <span className="text-xs font-mono text-text-dim">by {artifact.createdBy}</span>
        <a
          href={`/api/artifacts/${artifact.id}/download`}
          download={artifact.name}
          onClick={(e) => e.stopPropagation()}
          className="text-xs font-mono text-accent-blue ml-auto"
        >
          download
        </a>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Project } from "../types";

export function ProjectSelect() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.projects.list().then((p) => {
      setProjects(p);
      setLoading(false);
      if (p.length === 1) {
        navigate(`/${p[0]!.id}/world`, { replace: true });
      }
    }).catch(() => setLoading(false));
  }, [navigate]);

  if (loading) {
    return (
      <div className="h-dvh flex items-center justify-center bg-surface-0">
        <span className="font-mono text-text-dim text-sm">loading…</span>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col items-center justify-center bg-surface-0 px-6">
      <h1 className="font-syne font-bold text-2xl text-text-primary mb-2">Foundry</h1>
      <p className="font-mono text-text-dim text-sm mb-8">Select a project</p>
      <div className="w-full max-w-sm space-y-2">
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => navigate(`/${p.id}/world`)}
            className="w-full text-left bg-surface-2 border border-border rounded-xl p-4 hover:bg-surface-3 transition-colors"
          >
            <p className="font-syne font-medium text-text-primary">{p.name}</p>
            <p className="text-xs font-mono text-text-dim mt-0.5">{p.brief.tagline}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

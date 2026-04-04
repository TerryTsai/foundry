import { useState, useEffect } from "react";
import { api } from "../api";
import type { Project, Escalation } from "../types";

export function useProject(projectId: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [p, e] = await Promise.all([
          api.projects.get(projectId),
          api.escalations.list(projectId),
        ]);
        if (!cancelled) {
          setProject(p);
          setEscalations(e);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    // Poll every 30s
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  return { project, escalations, loading, setEscalations };
}

import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import type { Decision, DecisionDomain } from "../types";
import { FilterBar } from "../components/FilterBar";
import { DomainTag, ImpactTag, MadeByTag } from "../components/Tag";

const DOMAIN_FILTERS = [
  { value: "all", label: "All" },
  { value: "product", label: "Product" },
  { value: "engineering", label: "Engineering" },
  { value: "marketing", label: "Marketing" },
  { value: "business", label: "Business" },
  { value: "design", label: "Design" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LogView() {
  const { projectId } = useParams<{ projectId: string }>();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [domain, setDomain] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.decisions
      .log(projectId, domain !== "all" ? (domain as DecisionDomain) : undefined)
      .then((d) => {
        // Newest first
        setDecisions([...d].reverse());
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId, domain]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <FilterBar options={DOMAIN_FILTERS} value={domain} onChange={setDomain} />

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-text-dim font-mono text-sm">
            loading…
          </div>
        ) : decisions.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-text-dim font-mono text-sm">
            no decisions yet
          </div>
        ) : (
          <div className="space-y-2 pt-2">
            {decisions.map((d) => (
              <LogCard key={d.id} decision={d} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LogCard({ decision }: { decision: Decision }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="bg-surface-2 rounded-xl border border-border overflow-hidden cursor-pointer active:bg-surface-3 transition-colors"
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <DomainTag domain={decision.domain} />
              <span className="text-xs font-mono text-text-dim truncate">{decision.topic}</span>
            </div>
            <p className="font-lora text-text-primary text-sm leading-relaxed">
              {decision.decision}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <ImpactTag impact={decision.impact} />
            <MadeByTag madeBy={decision.madeBy} />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-2">
          <span className="text-xs font-mono text-text-dim">
            {formatDate(decision.timestamp)}
          </span>
          {decision.supersedes && (
            <span className="text-xs font-mono text-amber-500/70">supersedes</span>
          )}
          <span className="text-xs font-mono text-text-dim ml-auto">
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-border/50">
          <p className="text-xs font-mono text-text-dim mb-2 mt-3">rationale</p>
          <p className="text-sm text-text-secondary font-lora leading-relaxed">
            {decision.rationale}
          </p>

          {decision.alternatives && decision.alternatives.length > 0 && (
            <>
              <p className="text-xs font-mono text-text-dim mb-2 mt-4">alternatives</p>
              <div className="space-y-2">
                {decision.alternatives.map((alt, i) => (
                  <div key={i} className="bg-surface-3 rounded-lg p-3">
                    <p className="text-xs text-text-primary font-medium mb-0.5">{alt.option}</p>
                    <p className="text-xs text-text-dim">{alt.tradeoff}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {decision.tags && decision.tags.length > 0 && (
            <div className="flex gap-1.5 mt-3 flex-wrap">
              {decision.tags.map((tag) => (
                <span key={tag} className="text-xs font-mono px-2 py-0.5 rounded bg-white/5 text-text-dim border border-border">
                  {tag}
                </span>
              ))}
            </div>
          )}

          <p className="text-xs font-mono text-text-dim mt-3">
            id: {decision.id.slice(0, 8)}
          </p>
        </div>
      )}
    </div>
  );
}

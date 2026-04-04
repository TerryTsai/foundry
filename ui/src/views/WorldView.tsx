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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function WorldView() {
  const { projectId } = useParams<{ projectId: string }>();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [domain, setDomain] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.decisions
      .latest(projectId, domain !== "all" ? (domain as DecisionDomain) : undefined)
      .then((d) => {
        setDecisions(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId, domain]);

  const grouped = decisions.reduce<Record<string, Decision[]>>((acc, d) => {
    (acc[d.domain] ??= []).push(d);
    return acc;
  }, {});

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
          <div className="space-y-6 pt-2">
            {Object.entries(grouped).map(([dom, items]) => (
              <section key={dom}>
                <div className="flex items-center gap-2 mb-3">
                  <DomainTag domain={dom} />
                  <span className="text-xs font-mono text-text-dim">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((d) => (
                    <DecisionCard key={d.id} decision={d} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DecisionCard({ decision }: { decision: Decision }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="bg-surface-2 rounded-xl border border-border overflow-hidden"
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <p className="text-xs font-mono text-text-dim">{decision.topic}</p>
          <div className="flex gap-1.5 flex-shrink-0">
            <ImpactTag impact={decision.impact} />
            <MadeByTag madeBy={decision.madeBy} />
          </div>
        </div>
        <p className="font-lora text-text-primary text-sm leading-relaxed">
          {decision.decision}
        </p>
        <p className="text-xs font-mono text-text-dim mt-2">{timeAgo(decision.timestamp)}</p>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-border/50">
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
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import type { Task, TaskState } from "../types";
import { FilterBar } from "../components/FilterBar";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const AGENT_COLORS: string[] = [
  "text-accent-blue border-accent-blue/40 bg-accent-blue/10",
  "text-accent-purple border-accent-purple/40 bg-accent-purple/10",
  "text-accent-amber border-accent-amber/40 bg-accent-amber/10",
  "text-accent-green border-accent-green/40 bg-accent-green/10",
  "text-accent-red border-accent-red/40 bg-accent-red/10",
];

const AGENT_DOT_COLORS: string[] = [
  "bg-accent-blue",
  "bg-accent-purple",
  "bg-accent-amber",
  "bg-accent-green",
  "bg-accent-red",
];

function agentColorIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  return Math.abs(hash) % AGENT_COLORS.length;
}

function StateBadge({ state }: { state: TaskState }) {
  if (state === "pending")
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-white/5 text-text-dim border border-white/10">
        pending
      </span>
    );
  if (state === "running")
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono bg-accent-amber/10 text-accent-amber border border-accent-amber/30">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-amber animate-pulse" />
        running
      </span>
    );
  if (state === "complete")
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-accent-green/10 text-accent-green border border-accent-green/30">
        complete
      </span>
    );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-accent-red/10 text-accent-red border border-accent-red/30">
      failed
    </span>
  );
}

interface DecisionRequest {
  question: string;
  context?: string;
  recommendation?: string;
  rationale?: string;
  alternatives: Array<{ option: string; tradeoff: string }>;
}

function parseDecisionRequest(content: string): DecisionRequest | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "alternatives" in parsed &&
      Array.isArray((parsed as Record<string, unknown>).alternatives) &&
      ((parsed as Record<string, unknown>).alternatives as unknown[]).length > 0
    ) {
      return parsed as DecisionRequest;
    }
    return null;
  } catch {
    return null;
  }
}

interface FounderTaskFormProps {
  task: Task;
  onSubmitted: () => void;
}

function FounderTaskForm({ task, onSubmitted }: FounderTaskFormProps) {
  const successOutput = task.outputs.find((o) => !o.isFailure) ?? task.outputs[0];
  const [decision, setDecision] = useState<DecisionRequest | null>(null);
  const [loadingArtifacts, setLoadingArtifacts] = useState(true);
  const [submittingOption, setSubmittingOption] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [customContent, setCustomContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Fetch input artifact content on mount
  useEffect(() => {
    if (task.inputs.length === 0) { setLoadingArtifacts(false); return; }
    let cancelled = false;
    Promise.all(
      task.inputs.map((inp) =>
        api.artifacts.get(inp.artifact_id).catch(() => null)
      )
    ).then((artifacts) => {
      if (cancelled) return;
      for (const artifact of artifacts) {
        if (!artifact) continue;
        // Try inline content first
        const raw = (artifact as unknown as { content?: string }).content;
        if (raw) {
          const dr = parseDecisionRequest(raw);
          if (dr) { setDecision(dr); break; }
        }
      }
      setLoadingArtifacts(false);
    });
    return () => { cancelled = true; };
  }, [task.inputs]);

  async function submitOption(option: string, tradeoff: string) {
    if (!successOutput) return;
    setSubmittingOption(option);
    setError(null);
    try {
      await api.tasks.complete(task.id, {
        outputName: successOutput.name,
        content: JSON.stringify({ decision: option, tradeoff, selected_by: "founder" }),
        type: successOutput.type,
      });
      onSubmitted();
    } catch (err) {
      setError(String(err));
      setSubmittingOption(null);
    }
  }

  async function submitCustom() {
    if (!successOutput || !customContent.trim()) return;
    setSubmittingOption("__custom__");
    setError(null);
    try {
      await api.tasks.complete(task.id, {
        outputName: successOutput.name,
        content: customContent.trim(),
        type: successOutput.type,
      });
      onSubmitted();
    } catch (err) {
      setError(String(err));
      setSubmittingOption(null);
    }
  }

  const isSubmitting = submittingOption !== null;

  if (loadingArtifacts) {
    return (
      <div className="mt-3 pt-3 border-t border-border">
        <p className="text-xs font-mono text-text-dim animate-pulse">loading…</p>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-3">
      {decision ? (
        <>
          {/* Question */}
          <div>
            <p className="text-sm font-lora text-text-primary leading-snug">{decision.question}</p>
            {decision.context && (
              <p className="text-xs font-lora text-text-secondary mt-1 leading-snug">{decision.context}</p>
            )}
          </div>

          {/* Alternatives */}
          <div className="space-y-2">
            {decision.alternatives.map((alt) => {
              const isRecommended = alt.option === decision.recommendation;
              const isSubmittingThis = submittingOption === alt.option;
              return (
                <button
                  key={alt.option}
                  onClick={() => void submitOption(alt.option, alt.tradeoff)}
                  disabled={isSubmitting}
                  className={`w-full text-left rounded-xl border p-3.5 transition-colors min-h-[64px] ${
                    isRecommended
                      ? "bg-accent-blue/10 border-accent-blue/40 hover:bg-accent-blue/20"
                      : "bg-surface-3 border-border hover:bg-surface-3/80"
                  } disabled:opacity-50`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-syne font-medium ${isRecommended ? "text-accent-blue" : "text-text-primary"}`}>
                          {alt.option}
                        </span>
                        {isRecommended && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-blue/20 text-accent-blue border border-accent-blue/30">
                            recommended
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-lora text-text-secondary mt-0.5 leading-snug">{alt.tradeoff}</p>
                    </div>
                    <div className="flex-shrink-0 w-5 h-5 mt-0.5 flex items-center justify-center">
                      {isSubmittingThis ? (
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-accent-blue/40 border-t-accent-blue animate-spin block" />
                      ) : (
                        <span className={`text-base leading-none ${isRecommended ? "text-accent-blue" : "text-text-dim"}`}>›</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Custom override toggle */}
          {!showCustom ? (
            <button
              onClick={() => setShowCustom(true)}
              disabled={isSubmitting}
              className="text-xs font-mono text-text-dim hover:text-text-secondary transition-colors disabled:opacity-40"
            >
              write custom response ↓
            </button>
          ) : (
            <div className="space-y-2">
              <textarea
                value={customContent}
                onChange={(e) => setCustomContent(e.target.value)}
                placeholder="Custom response…"
                rows={3}
                className="w-full bg-surface-3 border border-border rounded-xl px-3 py-2.5 text-sm font-lora text-text-primary placeholder-text-dim focus:outline-none focus:border-white/30 resize-none"
              />
              <button
                onClick={() => void submitCustom()}
                disabled={isSubmitting || !customContent.trim()}
                className="w-full py-3 rounded-xl bg-white/5 text-text-secondary border border-border font-syne font-medium text-sm hover:bg-white/10 transition-colors disabled:opacity-40 min-h-[48px]"
              >
                {submittingOption === "__custom__" ? "Submitting…" : "Submit Custom"}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Fallback: plain textarea for unstructured inputs */}
          <textarea
            value={customContent}
            onChange={(e) => setCustomContent(e.target.value)}
            placeholder="Enter your response…"
            rows={4}
            className="w-full bg-surface-3 border border-border rounded-xl px-3 py-2.5 text-sm font-lora text-text-primary placeholder-text-dim focus:outline-none focus:border-white/30 resize-none"
          />
          <button
            onClick={() => void submitCustom()}
            disabled={isSubmitting || !customContent.trim()}
            className="w-full py-3 rounded-xl bg-accent-blue/20 text-accent-blue border border-accent-blue/30 font-syne font-medium text-sm hover:bg-accent-blue/30 transition-colors disabled:opacity-40 min-h-[48px]"
          >
            {submittingOption === "__custom__" ? "Submitting…" : "Submit Response"}
          </button>
        </>
      )}

      {error && <p className="text-xs font-mono text-accent-red">{error}</p>}
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  expanded: boolean;
  onToggle: () => void;
  onSubmitted: () => void;
}

function TaskCard({ task, expanded, onToggle, onSubmitted }: TaskCardProps) {
  const idx = agentColorIndex(task.agent);

  return (
    <div
      className={`bg-surface-2 rounded-xl border overflow-hidden ${
        task.state === "failed"
          ? "border-accent-red/30"
          : task.agent === "founder"
          ? "border-accent-amber/30"
          : "border-border"
      }`}
    >
      <button
        onClick={onToggle}
        className="w-full text-left p-4 hover:bg-surface-3/50 transition-colors"
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono border flex-shrink-0 ${AGENT_COLORS[idx]}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${AGENT_DOT_COLORS[idx]}`} />
            {task.agent}
          </span>
          <StateBadge state={task.state} />
        </div>

        <p className="text-sm font-lora text-text-primary leading-snug">
          {task.description}
        </p>

        {/* Input/output names */}
        <div className="flex flex-wrap gap-1 mt-2">
          {task.inputs.map((inp) => (
            <span key={inp.name} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-text-dim">
              in: {inp.name}
            </span>
          ))}
          {task.outputs.map((out) => (
            <span
              key={out.name}
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                out.isFailure ? "bg-accent-red/10 text-accent-red" : "bg-white/5 text-text-dim"
              }`}
            >
              out: {out.name}
            </span>
          ))}
        </div>

        {task.state === "running" && task.claimedAt && (
          <p className="text-xs font-mono text-accent-amber mt-1.5">
            claimed {timeAgo(task.claimedAt)}
          </p>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-border/50">
          <div className="mt-3 space-y-2">
            <p className="text-xs font-mono text-text-dim">
              id: <span className="text-text-secondary">{task.id}</span>
            </p>
            <p className="text-xs font-mono text-text-dim">
              created: <span className="text-text-secondary">{timeAgo(task.createdAt)}</span>
            </p>
            <p className="text-xs font-mono text-text-dim">
              by: <span className="text-text-secondary">{task.createdBy}</span>
            </p>
          </div>

          {/* Founder task submission form */}
          {task.agent === "founder" && task.state === "pending" && (
            <FounderTaskForm task={task} onSubmitted={onSubmitted} />
          )}
        </div>
      )}
    </div>
  );
}

const STATE_FILTERS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "running", label: "Running" },
  { value: "complete", label: "Complete" },
  { value: "failed", label: "Failed" },
];

export function TaskQueueView() {
  const { projectId } = useParams<{ projectId: string }>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadTasks = useCallback(() => {
    if (!projectId) return;
    api.tasks
      .list(projectId)
      .then((t) => {
        setTasks(t);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 5_000);
    return () => clearInterval(interval);
  }, [loadTasks]);

  // Build agent filters from task list
  const agentNames = Array.from(new Set(tasks.map((t) => t.agent))).sort();
  const agentFilters = agentNames.map((a) => ({ value: `agent:${a}`, label: a }));
  const filterOptions = [...STATE_FILTERS, ...agentFilters];

  const filtered = tasks.filter((t) => {
    if (filter === "all") return true;
    if (filter.startsWith("agent:")) return t.agent === filter.slice(6);
    return t.state === filter;
  });

  // Founder tasks first, then by createdAt desc
  const sorted = [...filtered].sort((a, b) => {
    if (a.agent === "founder" && b.agent !== "founder") return -1;
    if (b.agent === "founder" && a.agent !== "founder") return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const founderPending = tasks.filter((t) => t.agent === "founder" && t.state === "pending");

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Founder banner */}
      {founderPending.length > 0 && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-accent-amber/10 border-b border-accent-amber/20">
          <span className="w-2 h-2 rounded-full bg-accent-amber animate-pulse" />
          <span className="text-xs font-syne text-accent-amber">
            {founderPending.length} founder task{founderPending.length !== 1 ? "s" : ""} need{founderPending.length === 1 ? "s" : ""} your input
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="flex-shrink-0">
        <FilterBar options={filterOptions} value={filter} onChange={setFilter} />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-text-dim font-mono text-sm">
            loading…
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-text-dim font-mono text-sm">
            {filter === "all" ? "no tasks yet" : `no ${filter} tasks`}
          </div>
        ) : (
          <div className="space-y-2 pt-2">
            {sorted.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                expanded={expandedId === task.id}
                onToggle={() => setExpandedId((id) => (id === task.id ? null : task.id))}
                onSubmitted={loadTasks}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

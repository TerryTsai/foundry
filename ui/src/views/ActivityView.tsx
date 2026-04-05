import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import type { ActivityEntry } from "../types";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const EVENT_LABEL: Record<string, string> = {
  "decision-made": "Decision made",
  "escalation-created": "Escalation created",
  "escalation-resolved": "Escalation resolved",
  "override-logged": "Override logged",
  "engine-run-started": "Engine run started",
  "engine-run-complete": "Engine run complete",
  "engine-run-failed": "Engine run failed",
  "stage-advanced": "Stage advanced",
  "capability-executed": "Capability executed",
  "artifact-created": "Artifact created",
  "recovery-triggered": "Recovery triggered",
  // New loop-based events
  "loop-run-started": "Loop run started",
  "loop-run-complete": "Loop run complete",
  "loop-run-failed": "Loop run failed",
  "task-claimed": "Task claimed",
  "task-complete": "Task complete",
  "task-failed": "Task failed",
  "artifact-written": "Artifact written",
  "founder-task-created": "Founder task created",
};

// Map event type to accent color style
const EVENT_STYLE: Record<string, string> = {
  "decision-made": "bg-accent-purple",
  "escalation-created": "bg-accent-amber",
  "escalation-resolved": "bg-accent-green",
  "override-logged": "bg-accent-amber",
  "engine-run-started": "bg-accent-blue",
  "engine-run-complete": "bg-accent-blue",
  "engine-run-failed": "bg-accent-red",
  "loop-run-started": "bg-accent-blue",
  "loop-run-complete": "bg-accent-blue",
  "loop-run-failed": "bg-accent-red",
  "task-claimed": "bg-accent-amber",
  "task-complete": "bg-accent-green",
  "task-failed": "bg-accent-red",
  "artifact-created": "bg-accent-purple",
  "artifact-written": "bg-accent-purple",
  "capability-executed": "bg-white/20",
  "stage-advanced": "bg-accent-blue",
  "recovery-triggered": "bg-accent-amber",
  "founder-task-created": "bg-accent-amber",
};

// Label text color for badge-like display
const EVENT_TEXT_COLOR: Record<string, string> = {
  "engine-run-started": "text-accent-blue",
  "engine-run-complete": "text-accent-blue",
  "engine-run-failed": "text-accent-red",
  "loop-run-started": "text-accent-blue",
  "loop-run-complete": "text-accent-blue",
  "loop-run-failed": "text-accent-red",
  "task-claimed": "text-accent-amber",
  "task-complete": "text-accent-green",
  "task-failed": "text-accent-red",
  "artifact-created": "text-accent-purple",
  "artifact-written": "text-accent-purple",
  "capability-executed": "text-text-dim",
  "founder-task-created": "text-accent-amber",
  "decision-made": "text-accent-purple",
  "escalation-created": "text-accent-amber",
  "escalation-resolved": "text-accent-green",
};

function EventDot({ event }: { event: string }) {
  const color = EVENT_STYLE[event] ?? "bg-white/20";
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${color}`} />;
}

function EventDetail({ event, detail }: { event: string; detail: Record<string, unknown> }) {
  if (event === "decision-made") {
    return (
      <span className="text-xs font-mono text-text-dim">
        {String(detail.domain ?? "")} / {String(detail.topic ?? "")}
      </span>
    );
  }
  if (event === "escalation-created" || event === "escalation-resolved") {
    return (
      <span className="text-xs font-mono text-text-dim">
        {String(detail.topic ?? "")}
      </span>
    );
  }
  if (event === "engine-run-complete" || event === "loop-run-complete") {
    return (
      <span className="text-xs font-mono text-text-dim">
        {String(detail.decisionsMade ?? 0)} decisions · {String(detail.escalationsCreated ?? 0)} escalations
      </span>
    );
  }
  if (event === "capability-executed") {
    return (
      <span className="text-xs font-mono text-text-dim">
        {String(detail.actionName ?? "")} · {String(detail.status ?? "")}
      </span>
    );
  }
  if (event === "task-claimed" || event === "task-complete" || event === "task-failed") {
    return (
      <span className="text-xs font-mono text-text-dim">
        {String(detail.agent ?? "")}
        {detail.taskId ? ` · ${String(detail.taskId).slice(0, 8)}…` : ""}
      </span>
    );
  }
  if (event === "artifact-created" || event === "artifact-written") {
    return (
      <span className="text-xs font-mono text-text-dim">
        {String(detail.outputName ?? detail.name ?? "")}
        {detail.agent ? ` by ${String(detail.agent)}` : ""}
      </span>
    );
  }
  if (event === "founder-task-created") {
    return (
      <span className="text-xs font-mono text-text-dim">
        {String(detail.description ?? "").slice(0, 60)}
      </span>
    );
  }
  return null;
}

export function ActivityView() {
  const { projectId } = useParams<{ projectId: string }>();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    api.activity
      .list(projectId, 150)
      .then((e) => {
        setEntries(e);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    const interval = setInterval(() => {
      api.activity.list(projectId, 150).then(setEntries).catch(() => {});
    }, 10_000);
    return () => clearInterval(interval);
  }, [projectId]);

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <p className="text-xs font-mono text-text-dim mb-4 uppercase tracking-wider">Activity Feed</p>

      {loading ? (
        <div className="text-text-dim font-mono text-sm">loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-text-dim font-mono text-sm">no activity yet</div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[3px] top-2 bottom-0 w-px bg-border" />

          <div className="space-y-0">
            {entries.map((entry) => (
              <div key={entry.id} className="flex gap-4 pl-1 pb-5">
                <EventDot event={entry.event} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span
                      className={`text-sm font-syne ${
                        EVENT_TEXT_COLOR[entry.event] ?? "text-text-primary"
                      }`}
                    >
                      {EVENT_LABEL[entry.event] ?? entry.event}
                    </span>
                    <span className="text-xs font-mono text-text-dim flex-shrink-0">
                      {timeAgo(entry.timestamp)}
                    </span>
                  </div>
                  <EventDetail event={entry.event} detail={entry.detail} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

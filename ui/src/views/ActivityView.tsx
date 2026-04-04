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
};

const EVENT_COLOR: Record<string, string> = {
  "decision-made": "bg-purple-500",
  "escalation-created": "bg-amber-500",
  "escalation-resolved": "bg-green-500",
  "override-logged": "bg-amber-400",
  "engine-run-started": "bg-blue-500",
  "engine-run-complete": "bg-blue-400",
  "engine-run-failed": "bg-red-500",
  "capability-executed": "bg-pink-500",
  "artifact-created": "bg-teal-500",
};

function EventDot({ event }: { event: string }) {
  const color = EVENT_COLOR[event] ?? "bg-white/20";
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
  if (event === "engine-run-complete") {
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
    }, 15_000);
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
                    <span className="text-sm font-syne text-text-primary">
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

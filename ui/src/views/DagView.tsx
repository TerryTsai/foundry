import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import type { Task, TaskState, EngineRun } from "../types";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Consistent color per agent name using accent tokens
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
  if (state === "pending") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-white/5 text-text-dim border border-white/10">
        pending
      </span>
    );
  }
  if (state === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono bg-accent-amber/10 text-accent-amber border border-accent-amber/30">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-amber animate-pulse" />
        running
      </span>
    );
  }
  if (state === "complete") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-accent-green/10 text-accent-green border border-accent-green/30">
        complete
      </span>
    );
  }
  // failed
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-accent-red/10 text-accent-red border border-accent-red/30">
      failed
    </span>
  );
}

// Build depth map: how many hops from head tasks (tasks with no inputs, or inputs from non-tasks)
function buildDepthMap(tasks: Task[]): Map<string, number> {
  const taskIds = new Set(tasks.map((t) => t.id));
  // artifact_id -> producing task
  const artifactProducer = new Map<string, string>();
  for (const task of tasks) {
    for (const out of task.outputs) {
      // We don't have artifact ids on outputs directly, but we can infer
      // by matching task inputs' artifact_ids to tasks
      void out;
    }
  }

  // Build: for each task, what are its "parent" tasks (producers of its input artifacts)?
  // We track this by artifact_id. The artifact_id in inputs references an artifact produced by some task.
  // We don't have direct task->task edges in the data. We need to connect via artifact_ids.
  // The tasks API returns inputs as {name, artifact_id}. The artifact taskId field lets us trace.
  // Since we don't have artifact metadata here, let's compute depth from createdBy field as proxy.
  // Actually: "createdBy" on a task is the task_id or 'system' that created this task.
  // So we can build parent->child edges via createdBy!

  const parentEdges = new Map<string, string>(); // taskId -> parent taskId
  for (const task of tasks) {
    if (taskIds.has(task.createdBy)) {
      parentEdges.set(task.id, task.createdBy);
    }
  }

  const depthMap = new Map<string, number>();

  function getDepth(id: string): number {
    if (depthMap.has(id)) return depthMap.get(id)!;
    const parent = parentEdges.get(id);
    if (!parent || !taskIds.has(parent)) {
      depthMap.set(id, 0);
      return 0;
    }
    const d = getDepth(parent) + 1;
    depthMap.set(id, d);
    return d;
  }

  for (const task of tasks) {
    getDepth(task.id);
  }

  // Also use artifact_id connections if available from inputs
  // Mark tasks with no taskId parent as depth 0
  void artifactProducer;
  return depthMap;
}

interface TaskCardProps {
  task: Task;
  isHead: boolean;
  isTail: boolean;
  onClick: (task: Task) => void;
}

function TaskCard({ task, isHead, isTail, onClick }: TaskCardProps) {
  const idx = agentColorIndex(task.agent);
  const agentColor = AGENT_COLORS[idx]!;
  const dotColor = AGENT_DOT_COLORS[idx]!;

  const borderClass =
    isHead
      ? "border-accent-blue/60"
      : isTail
      ? "border-accent-purple/60"
      : task.state === "failed"
      ? "border-accent-red/40"
      : task.state === "running"
      ? "border-accent-amber/40"
      : "border-border";

  return (
    <button
      onClick={() => onClick(task)}
      className={`w-full text-left bg-surface-2 rounded-xl border ${borderClass} p-3 hover:bg-surface-3 transition-colors active:bg-surface-3`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono border flex-shrink-0 ${agentColor}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
          {task.agent}
        </span>
        <StateBadge state={task.state} />
      </div>
      <p className="text-sm font-lora text-text-primary leading-snug line-clamp-2">
        {task.description}
      </p>
      {task.state === "running" && task.claimedAt && (
        <p className="text-xs font-mono text-accent-amber mt-1.5">
          claimed {timeAgo(task.claimedAt)}
        </p>
      )}
      <div className="flex flex-wrap gap-1 mt-2">
        {(isHead || isTail) && (
          <span
            className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
              isHead ? "bg-accent-blue/15 text-accent-blue" : "bg-accent-purple/15 text-accent-purple"
            }`}
          >
            {isHead ? "HEAD" : "TAIL"}
          </span>
        )}
        {task.outputs.map((o) => (
          <span
            key={o.name}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-text-dim"
          >
            {o.name}
          </span>
        ))}
      </div>
    </button>
  );
}

interface TaskDetailDrawerProps {
  task: Task;
  onClose: () => void;
}

function TaskDetailDrawer({ task, onClose }: TaskDetailDrawerProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div
        className="bg-surface-1 border-t border-border rounded-t-2xl p-4 max-h-[70vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-mono text-text-dim uppercase tracking-wider">Task Detail</span>
          <button onClick={onClose} className="text-text-dim hover:text-text-primary p-1 min-h-[44px] min-w-[44px] flex items-center justify-center">
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono border ${AGENT_COLORS[agentColorIndex(task.agent)]}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${AGENT_DOT_COLORS[agentColorIndex(task.agent)]}`} />
            {task.agent}
          </span>
          <StateBadge state={task.state} />
        </div>

        <p className="font-lora text-text-primary text-sm leading-relaxed mb-4">{task.description}</p>

        <div className="space-y-3">
          {task.inputs.length > 0 && (
            <div>
              <p className="text-xs font-mono text-text-dim mb-1.5">inputs</p>
              <div className="space-y-1">
                {task.inputs.map((inp) => (
                  <div key={inp.name} className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-secondary">{inp.name}</span>
                    <span className="text-xs font-mono text-text-dim truncate flex-1">{inp.artifact_id}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {task.outputs.length > 0 && (
            <div>
              <p className="text-xs font-mono text-text-dim mb-1.5">outputs</p>
              <div className="space-y-1">
                {task.outputs.map((out) => (
                  <div key={out.name} className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-secondary">{out.name}</span>
                    <span className="text-xs font-mono text-text-dim">{out.type}</span>
                    {out.isFailure && (
                      <span className="text-[10px] font-mono text-accent-red bg-accent-red/10 px-1.5 py-0.5 rounded">failure</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-1 border-t border-border">
            <p className="text-xs font-mono text-text-dim">
              id: <span className="text-text-secondary">{task.id}</span>
            </p>
            <p className="text-xs font-mono text-text-dim mt-0.5">
              created: <span className="text-text-secondary">{timeAgo(task.createdAt)}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DagView() {
  const { projectId } = useParams<{ projectId: string }>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [runs, setRuns] = useState<{ current: EngineRun | null; last: EngineRun | null }>({
    current: null,
    last: null,
  });
  const [triggering, setTriggering] = useState(false);

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

  const loadRuns = useCallback(() => {
    if (!projectId) return;
    api.admin.getRuns(projectId).then(setRuns).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    loadTasks();
    loadRuns();
    const tasksInterval = setInterval(loadTasks, 5_000);
    const runsInterval = setInterval(loadRuns, 3_000);
    return () => {
      clearInterval(tasksInterval);
      clearInterval(runsInterval);
    };
  }, [loadTasks, loadRuns]);

  async function handleRunNow() {
    if (!projectId || triggering) return;
    setTriggering(true);
    try {
      await api.admin.runNow(projectId);
      loadRuns();
    } catch {
      // ignore
    } finally {
      setTriggering(false);
    }
  }

  const isRunning = runs.current?.status === "running";

  // Group tasks by depth
  const depthMap = buildDepthMap(tasks);
  const maxDepth = tasks.length > 0 ? Math.max(...Array.from(depthMap.values())) : 0;

  const byDepth: Task[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const task of tasks) {
    const d = depthMap.get(task.id) ?? 0;
    byDepth[d]!.push(task);
  }

  // Find head and tail tasks
  const headTaskIds = new Set<string>();
  const tailTaskIds = new Set<string>();

  // Head: tasks with no parent task (depth 0 essentially, or tasks that are the starting point)
  for (const task of tasks) {
    if ((depthMap.get(task.id) ?? 0) === 0 && !tasks.some((t) => t.createdBy === task.id)) {
      // It's a root - if it's also the only task or has no predecessors
    }
  }

  // Simpler approach: head = tasks with no task-parent, tail = tasks with no task-children
  const taskIds = new Set(tasks.map((t) => t.id));
  const tasksWithParent = new Set<string>();
  const tasksWithChildren = new Set<string>();
  for (const task of tasks) {
    if (taskIds.has(task.createdBy)) {
      tasksWithParent.add(task.id);
      tasksWithChildren.add(task.createdBy);
    }
  }

  for (const task of tasks) {
    if (!tasksWithParent.has(task.id)) headTaskIds.add(task.id);
    if (!tasksWithChildren.has(task.id)) tailTaskIds.add(task.id);
  }

  // Stats
  const pendingCount = tasks.filter((t) => t.state === "pending").length;
  const runningCount = tasks.filter((t) => t.state === "running").length;
  const completeCount = tasks.filter((t) => t.state === "complete").length;
  const failedCount = tasks.filter((t) => t.state === "failed").length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-text-dim">
            {tasks.length} tasks
          </span>
          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-xs font-mono text-accent-amber">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-amber animate-pulse" />
              {runningCount} running
            </span>
          )}
          {failedCount > 0 && (
            <span className="text-xs font-mono text-accent-red">{failedCount} failed</span>
          )}
        </div>
        <button
          onClick={() => void handleRunNow()}
          disabled={isRunning || triggering}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors disabled:opacity-50 min-h-[36px]"
          style={
            isRunning
              ? { borderColor: "#4ade80", color: "#4ade80" }
              : { borderColor: "#2e2e2e", color: "#666" }
          }
        >
          {isRunning ? (
            <>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
              running
            </>
          ) : triggering ? (
            "queuing…"
          ) : (
            "▷ Run"
          )}
        </button>
      </div>

      {/* Stats bar */}
      {tasks.length > 0 && (
        <div className="flex-shrink-0 flex gap-3 px-4 py-2 border-b border-border overflow-x-auto scrollbar-none">
          <span className="text-xs font-mono text-text-dim flex-shrink-0">
            {pendingCount} pending
          </span>
          <span className="text-text-dim text-xs">·</span>
          <span className="text-xs font-mono text-accent-amber flex-shrink-0">
            {runningCount} running
          </span>
          <span className="text-text-dim text-xs">·</span>
          <span className="text-xs font-mono text-accent-green flex-shrink-0">
            {completeCount} complete
          </span>
          <span className="text-text-dim text-xs">·</span>
          <span className="text-xs font-mono text-accent-red flex-shrink-0">
            {failedCount} failed
          </span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-text-dim font-mono text-sm">
            loading…
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <p className="text-text-dim font-mono text-sm">no tasks yet</p>
            <p className="text-text-dim font-mono text-xs">trigger a run to generate tasks</p>
          </div>
        ) : (
          <div className="space-y-4">
            {byDepth.map((levelTasks, depth) => {
              if (levelTasks.length === 0) return null;
              return (
                <div key={depth}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-mono text-text-dim uppercase tracking-wider">
                      depth {depth}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[10px] font-mono text-text-dim">{levelTasks.length}</span>
                  </div>
                  <div className="space-y-2">
                    {levelTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        isHead={headTaskIds.has(task.id)}
                        isTail={tailTaskIds.has(task.id)}
                        onClick={setSelectedTask}
                      />
                    ))}
                  </div>
                  {depth < maxDepth && (
                    <div className="flex justify-center mt-3">
                      <div className="flex flex-col items-center gap-0.5 text-text-dim">
                        <div className="w-px h-3 bg-border" />
                        <span className="text-[10px] font-mono text-text-dim">↓</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Task detail drawer */}
      {selectedTask && (
        <TaskDetailDrawer task={selectedTask} onClose={() => setSelectedTask(null)} />
      )}
    </div>
  );
}

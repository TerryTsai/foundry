import { useState, useEffect, useCallback } from "react";
import { NavLink, useParams, useNavigate } from "react-router-dom";
import type { Escalation } from "../types";
import { EscalationModal } from "./EscalationModal";
import { api } from "../api";

interface ShellProps {
  children: React.ReactNode;
  escalations: Escalation[];
  onEscalationResolved: () => void;
  projectName?: string;
}

export function Shell({ children, escalations, onEscalationResolved, projectName }: ShellProps) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [modalEscalation, setModalEscalation] = useState<Escalation | null>(null);
  const [showConfigMenu, setShowConfigMenu] = useState(false);
  const [founderTaskCount, setFounderTaskCount] = useState(0);
  const [isLoopRunning, setIsLoopRunning] = useState(false);

  const openCount = escalations.length;

  function handleResolved() {
    setModalEscalation(null);
    onEscalationResolved();
  }

  // Poll for founder tasks and loop run status
  const pollStatus = useCallback(() => {
    if (!projectId) return;
    // Founder tasks
    api.tasks
      .list(projectId)
      .then((tasks) => {
        const founderPending = tasks.filter(
          (t) => t.agent === "founder" && t.state === "pending"
        ).length;
        setFounderTaskCount(founderPending);
      })
      .catch(() => {});

    // Loop run status
    api.admin
      .getRuns(projectId)
      .then((runs) => {
        setIsLoopRunning(runs.current?.status === "running");
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    pollStatus();
    const interval = setInterval(pollStatus, 10_000);
    return () => clearInterval(interval);
  }, [pollStatus]);

  return (
    <div className="h-dvh flex flex-col bg-surface-0 overflow-hidden">
      {/* Topbar */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 h-12 border-b border-border bg-surface-1">
        <span className="font-syne font-semibold text-sm text-text-primary tracking-wide">
          {projectName ?? "Foundry"}
        </span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-text-dim">foundry</span>
          <div className="relative">
            <button
              onClick={() => setShowConfigMenu((v) => !v)}
              className="w-8 h-8 flex items-center justify-center text-text-dim hover:text-text-primary transition-colors rounded-lg hover:bg-surface-3"
              aria-label="Project settings"
            >
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <circle cx="12" cy="5" r="1" fill="currentColor" />
                <circle cx="12" cy="12" r="1" fill="currentColor" />
                <circle cx="12" cy="19" r="1" fill="currentColor" />
              </svg>
            </button>
            {showConfigMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowConfigMenu(false)} />
                <div className="absolute right-0 top-9 z-50 bg-surface-2 border border-border rounded-xl shadow-xl min-w-[140px] overflow-hidden">
                  <button
                    onClick={() => {
                      setShowConfigMenu(false);
                      navigate(`/${projectId}/config`);
                    }}
                    className="w-full text-left px-4 py-3 text-xs font-syne text-text-primary hover:bg-surface-3 transition-colors min-h-[44px]"
                  >
                    Config
                  </button>
                  <button
                    onClick={() => {
                      setShowConfigMenu(false);
                      navigate("/");
                    }}
                    className="w-full text-left px-4 py-3 text-xs font-syne text-text-secondary hover:bg-surface-3 transition-colors min-h-[44px]"
                  >
                    Switch Project
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Escalation banner */}
      {openCount > 0 && (
        <div
          className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 cursor-pointer"
          onClick={() => setModalEscalation(escalations[0] ?? null)}
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs font-syne text-amber-300">
              {openCount} decision{openCount !== 1 ? "s" : ""} need{openCount === 1 ? "s" : ""} your input
            </span>
          </div>
          <span className="text-xs font-mono text-amber-400">Review →</span>
        </div>
      )}

      {/* Page content */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>

      {/* Bottom nav */}
      <nav className="flex-shrink-0 flex border-t border-border bg-surface-1 pb-safe">
        <NavItem
          to={`/${projectId}/dag`}
          label="DAG"
          icon={<DagIcon />}
          pulse={isLoopRunning}
        />
        <NavItem
          to={`/${projectId}/tasks`}
          label="Tasks"
          icon={<TasksIcon />}
          badge={founderTaskCount}
        />
        <NavItem
          to={`/${projectId}/artifacts`}
          label="Artifacts"
          icon={<ArtifactsIcon />}
        />
        <NavItem
          to={`/${projectId}/capabilities`}
          label="Integrations"
          icon={<CapIcon />}
        />
        <NavItem
          to={`/${projectId}/activity`}
          label="Activity"
          icon={<ActivityIcon />}
        />
      </nav>

      {/* Escalation modal */}
      {modalEscalation && (
        <EscalationModal
          escalation={modalEscalation}
          onResolved={handleResolved}
          onClose={() => setModalEscalation(null)}
        />
      )}
    </div>
  );
}

function NavItem({
  to,
  label,
  icon,
  badge,
  pulse,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  pulse?: boolean;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-syne relative min-h-[52px] transition-colors ${
          isActive ? "text-text-primary" : "text-text-dim hover:text-text-secondary"
        }`
      }
    >
      <span className="relative">
        {icon}
        {badge != null && badge > 0 && (
          <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] rounded-full bg-amber-400 text-black text-[9px] font-bold flex items-center justify-center px-0.5">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
        {pulse && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent-green animate-pulse" />
        )}
      </span>
      {label}
    </NavLink>
  );
}

function DagIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="3" width="5" height="4" rx="1" />
      <rect x="16" y="3" width="5" height="4" rx="1" />
      <rect x="9.5" y="10" width="5" height="4" rx="1" />
      <rect x="3" y="17" width="5" height="4" rx="1" />
      <rect x="16" y="17" width="5" height="4" rx="1" />
      <line x1="8" y1="5" x2="16" y2="5" />
      <line x1="5.5" y1="7" x2="10.5" y2="10" />
      <line x1="18.5" y1="7" x2="13.5" y2="10" />
      <line x1="10.5" y1="14" x2="5.5" y2="17" />
      <line x1="13.5" y1="14" x2="18.5" y2="17" />
    </svg>
  );
}

function TasksIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path d="M9 12h6M9 16h4M7 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-2" />
      <rect x="7" y="2" width="10" height="4" rx="1" />
      <path d="M9 8l1 1 2-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function CapIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function ArtifactsIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    </svg>
  );
}

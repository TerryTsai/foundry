import { useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import type { Escalation } from "../types";
import { EscalationModal } from "./EscalationModal";

interface ShellProps {
  children: React.ReactNode;
  escalations: Escalation[];
  onEscalationResolved: () => void;
  projectName?: string;
}

export function Shell({ children, escalations, onEscalationResolved, projectName }: ShellProps) {
  const { projectId } = useParams<{ projectId: string }>();
  const [modalEscalation, setModalEscalation] = useState<Escalation | null>(null);

  const openCount = escalations.length;

  function handleResolved() {
    setModalEscalation(null);
    onEscalationResolved();
  }

  return (
    <div className="h-dvh flex flex-col bg-surface-0 overflow-hidden">
      {/* Topbar */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 h-12 border-b border-border bg-surface-1">
        <span className="font-syne font-semibold text-sm text-text-primary tracking-wide">
          {projectName ?? "Foundry"}
        </span>
        <span className="font-mono text-xs text-text-dim">foundry</span>
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
        <NavItem to={`/${projectId}/world`} label="World" icon={<WorldIcon />} badge={openCount} />
        <NavItem to={`/${projectId}/activity`} label="Activity" icon={<ActivityIcon />} />
        <NavItem to={`/${projectId}/log`} label="Log" icon={<LogIcon />} />
        <NavItem to={`/${projectId}/capabilities`} label="Integrations" icon={<CapIcon />} />
        <NavItem to={`/${projectId}/artifacts`} label="Artifacts" icon={<ArtifactsIcon />} />
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
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
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
      </span>
      {label}
    </NavLink>
  );
}

function WorldIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c-2.5 3-4 5.5-4 9s1.5 6 4 9M12 3c2.5 3 4 5.5 4 9s-1.5 6-4 9" />
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

function LogIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path d="M9 12h6M9 16h4M7 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-2" />
      <rect x="7" y="2" width="10" height="4" rx="1" />
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

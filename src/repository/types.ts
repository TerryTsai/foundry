// Domain types — no DB column names, no ORM types.

export type ProjectStatus = "active" | "paused" | "complete" | "archived";

export interface ProjectBrief {
  tagline: string;
  problem: string;
  user: string;
  mvp: string;
  constraints: string;
  existing: string;
  assumptions: string[];
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  status: ProjectStatus;
  brief: ProjectBrief;
  createdAt: string;
}

export type DecisionDomain =
  | "product"
  | "engineering"
  | "marketing"
  | "business"
  | "design";
export type DecisionImpact = "low" | "medium" | "high";
export type DecisionReversibility = "easy" | "hard" | "permanent";
export type DecisionMadeBy = "agent" | "ceo" | "agent-timeout" | "ceo-override";

export interface Decision {
  id: string;
  projectId: string;
  timestamp: string;
  domain: DecisionDomain;
  topic: string;
  decision: string;
  rationale: string;
  alternatives: Array<{ option: string; tradeoff: string }> | null;
  madeBy: DecisionMadeBy;
  impact: DecisionImpact;
  reversibility: DecisionReversibility;
  supersedes: string | null;
  tags: string[] | null;
}

export interface NewDecision {
  projectId: string;
  domain: DecisionDomain;
  topic: string;
  decision: string;
  rationale: string;
  alternatives?: Array<{ option: string; tradeoff: string }>;
  madeBy: DecisionMadeBy;
  impact: DecisionImpact;
  reversibility: DecisionReversibility;
  supersedes?: string;
  tags?: string[];
}

export interface DecisionFilter {
  projectId: string;
  domain?: DecisionDomain;
  impact?: DecisionImpact;
  madeBy?: DecisionMadeBy;
  since?: string;
}

export interface Escalation {
  id: string;
  projectId: string;
  domain: DecisionDomain;
  topic: string;
  draftDecision: string;
  draftRationale: string;
  draftAlternatives: Array<{ option: string; tradeoff: string }> | null;
  impact: DecisionImpact;
  createdAt: string;
  timeoutAt: string;
  resolvedAt: string | null;
  resolvedBy: "ceo" | "timeout" | null;
  resolution: string | null;
}

export interface NewEscalation {
  projectId: string;
  domain: DecisionDomain;
  topic: string;
  draftDecision: string;
  draftRationale: string;
  draftAlternatives?: Array<{ option: string; tradeoff: string }>;
  impact: DecisionImpact;
  timeoutHours?: number;
}

export interface EscalationResolution {
  resolvedBy: "ceo" | "timeout";
  resolution?: string;
}

export type ActivityEvent =
  | "decision-made"
  | "escalation-created"
  | "escalation-resolved"
  | "override-logged"
  | "engine-run-started"
  | "engine-run-complete"
  | "engine-run-failed"
  | "stage-advanced"
  | "capability-executed"
  | "artifact-created"
  | "recovery-triggered";

export interface ActivityEntry {
  id: string;
  projectId: string;
  timestamp: string;
  event: ActivityEvent;
  detail: Record<string, unknown>;
}

export type EngineRunStatus = "running" | "complete" | "failed" | "recovered";

export interface EngineRun {
  id: string;
  projectId: string;
  startedAt: string;
  completedAt: string | null;
  status: EngineRunStatus;
  decisionsMade: number;
  escalationsCreated: number;
  actionsExecuted: number;
  summary: string | null;
  error: string | null;
}

export interface RunSummary {
  decisionsMade: number;
  escalationsCreated: number;
  actionsExecuted: number;
  summary: string;
}

export type CapabilityCategory =
  | "deployment"
  | "marketing"
  | "communication"
  | "infrastructure"
  | "payments"
  | "custom";

export interface CapabilityDefinition {
  id: string;
  name: string;
  category: CapabilityCategory;
  description: string;
  setupGuide: string;
  configSchema: Record<string, unknown>;
  isBuiltin: boolean;
  createdAt: string;
}

export interface NewCapabilityDefinition {
  name: string;
  category: CapabilityCategory;
  description: string;
  setupGuide: string;
  configSchema: Record<string, unknown>;
  isBuiltin?: boolean;
}

export type CapabilityActionType = "bash" | "http" | "playwright";

export interface CapabilityAction {
  id: string;
  capabilityId: string;
  name: string;
  description: string;
  actionType: CapabilityActionType;
  script: string;
  paramSchema: Record<string, unknown> | null;
  isDestructive: boolean;
  requiresApproval: boolean;
}

export type CapabilityStatus =
  | "pending"
  | "configured"
  | "active"
  | "error"
  | "revoked";

export interface ProjectCapability {
  id: string;
  projectId: string;
  capabilityId: string;
  status: CapabilityStatus;
  lastTestedAt: string | null;
  lastTestStatus: "success" | "failure" | null;
  lastTestOutput: string | null;
  configuredAt: string | null;
  notes: string | null;
}

export type ExecutionStatus = "success" | "failure" | "timeout";

export interface ExecutionResult {
  status: ExecutionStatus;
  output: string | null;
  error: string | null;
  durationMs: number;
}

export interface CapabilityExecution {
  id: string;
  projectCapabilityId: string;
  actionId: string;
  params: Record<string, string> | null;
  triggeredBy: "agent" | "founder-test";
  executedAt: string;
  status: ExecutionStatus;
  output: string | null;
  error: string | null;
  durationMs: number | null;
}

export interface AccountState {
  id: string;
  projectCapabilityId: string;
  capturedAt: string;
  trigger: "pre-action" | "post-action" | "scheduled" | "manual" | "on-configure";
  state: Record<string, unknown>;
  rawResponse: string | null;
  triggeredByExecution: string | null;
}

export type ArtifactType =
  | "code-snapshot"
  | "git-bundle"
  | "account-state"
  | "deployed-config"
  | "generated-content"
  | "environment-snapshot"
  | "build-output";

export interface Artifact {
  id: string;
  projectId: string;
  type: ArtifactType;
  name: string;
  description: string | null;
  contentSize: number;
  contentHash: string;
  metadata: Record<string, unknown> | null;
  snapshotOf: string | null;
  supersedes: string | null;
  createdAt: string;
  createdBy: "agent" | "founder" | "system";
}

export interface ArtifactWithContent extends Artifact {
  content: Buffer;
}

export interface NewArtifact {
  projectId: string;
  type: ArtifactType;
  name: string;
  description?: string;
  content: string | Buffer;
  metadata?: Record<string, unknown>;
  snapshotOf?: string;
  supersedes?: string;
  createdBy: "agent" | "founder" | "system";
}

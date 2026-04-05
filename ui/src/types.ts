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
  status: "active" | "paused" | "complete" | "archived";
  brief: ProjectBrief;
  createdAt: string;
}

export type DecisionDomain = "product" | "engineering" | "marketing" | "business" | "design";
export type DecisionImpact = "low" | "medium" | "high";
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
  reversibility: "easy" | "hard" | "permanent";
  supersedes: string | null;
  tags: string[] | null;
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

export interface ActivityEntry {
  id: string;
  projectId: string;
  timestamp: string;
  event: string;
  detail: Record<string, unknown>;
}

export interface CapabilityDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  setupGuide: string;
  configSchema: Record<string, unknown>;
  isBuiltin: boolean;
}

export interface CapabilityAction {
  id: string;
  capabilityId: string;
  name: string;
  description: string;
  actionType: "bash" | "http" | "playwright";
  isDestructive: boolean;
  requiresApproval: boolean;
}

export interface ProjectCapability {
  id: string;
  projectId: string;
  capabilityId: string;
  status: "pending" | "configured" | "active" | "error" | "revoked";
  lastTestedAt: string | null;
  lastTestStatus: "success" | "failure" | null;
  lastTestOutput: string | null;
  configuredAt: string | null;
  notes: string | null;
  definition?: CapabilityDefinition;
  actions?: CapabilityAction[];
}

export interface EngineRun {
  id: string;
  projectId: string;
  status: "running" | "completed" | "failed" | "complete" | "recovered";
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  error: string | null;
}

export interface TaskInput {
  name: string;
  artifact_id: string;
}

export interface TaskOutput {
  name: string;
  type: string;
  isFailure?: boolean;
}

export type TaskState = "pending" | "running" | "complete" | "failed";

export interface Task {
  id: string;
  projectId: string;
  agent: string;
  description: string;
  createdAt: string;
  createdBy: string;
  claimedAt: string | null;
  inputs: TaskInput[];
  outputs: TaskOutput[];
  state: TaskState;
}

export interface ProjectConfigHead {
  name: string;
  type: string;
  artifact_id: string;
}

export interface ProjectConfigTail {
  name: string;
  type: string;
}

export interface AgentDefinition {
  name: string;
  consumes: string[];
  produces: string[];
  tools: string[];
  prompt: string | null;
}

export interface ProjectConfig {
  workspace: string;
  head: ProjectConfigHead[];
  tail: ProjectConfigTail[];
  agents: AgentDefinition[];
}

export interface DagValidationResult {
  valid: boolean;
  unreachableTail: string[];
  orphanedAgents: string[];
  missingProducers: string[];
}

export interface LoopRun {
  id: string;
  projectId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
}

export interface Artifact {
  id: string;
  projectId: string;
  type: string;
  name: string;
  description: string | null;
  contentSize: number;
  contentHash: string;
  metadata: Record<string, unknown> | null;
  snapshotOf: string | null;
  supersedes: string | null;
  createdAt: string;
  createdBy: string;
  taskId: string | null;
  outputName: string | null;
}

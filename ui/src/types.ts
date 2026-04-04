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
  createdAt: string;
  createdBy: string;
}

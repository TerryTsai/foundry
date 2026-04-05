import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ── Core ──────────────────────────────────────────────────────────

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("active"),
  brief: text("brief").notNull(), // JSON
  createdAt: text("created_at").notNull(),
});

// APPEND ONLY. No UPDATE. No DELETE.
export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    timestamp: text("timestamp").notNull(),
    domain: text("domain").notNull(),
    topic: text("topic").notNull(),
    decision: text("decision").notNull(),
    rationale: text("rationale").notNull(),
    alternatives: text("alternatives"), // JSON
    madeBy: text("made_by").notNull(),
    impact: text("impact").notNull(),
    reversibility: text("reversibility").notNull(),
    supersedes: text("supersedes").references((): ReturnType<typeof text> => decisions.id),
    tags: text("tags"), // JSON
  },
  (t) => [
    index("idx_decisions_project").on(t.projectId, t.timestamp),
    index("idx_decisions_topic").on(t.projectId, t.domain, t.topic, t.timestamp),
  ]
);

export const escalations = sqliteTable(
  "escalations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    domain: text("domain").notNull(),
    topic: text("topic").notNull(),
    draftDecision: text("draft_decision").notNull(),
    draftRationale: text("draft_rationale").notNull(),
    draftAlternatives: text("draft_alternatives"), // JSON
    impact: text("impact").notNull(),
    createdAt: text("created_at").notNull(),
    timeoutAt: text("timeout_at").notNull(),
    resolvedAt: text("resolved_at"),
    resolvedBy: text("resolved_by"),
    resolution: text("resolution"),
  },
  (t) => [
    index("idx_escalations_open").on(t.projectId, t.resolvedAt),
  ]
);

// APPEND ONLY.
export const activityLog = sqliteTable(
  "activity_log",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    timestamp: text("timestamp").notNull(),
    event: text("event").notNull(),
    detail: text("detail").notNull(), // JSON
  },
  (t) => [
    index("idx_activity_project").on(t.projectId, t.timestamp),
  ]
);

export const engineRuns = sqliteTable(
  "engine_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    status: text("status").notNull().default("running"),
    decisionsMade: integer("decisions_made").default(0),
    escalationsCreated: integer("escalations_created").default(0),
    actionsExecuted: integer("actions_executed").default(0),
    summary: text("summary"),
    error: text("error"),
  },
  (t) => [
    index("idx_engine_runs_project").on(t.projectId, t.startedAt),
  ]
);

// ── Capabilities ──────────────────────────────────────────────────

export const capabilities = sqliteTable("capabilities", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  setupGuide: text("setup_guide").notNull(),
  configSchema: text("config_schema").notNull(), // JSON Schema
  isBuiltin: integer("is_builtin").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const capabilityActions = sqliteTable(
  "capability_actions",
  {
    id: text("id").primaryKey(),
    capabilityId: text("capability_id")
      .notNull()
      .references(() => capabilities.id),
    name: text("name").notNull(),
    description: text("description").notNull(),
    actionType: text("action_type").notNull(),
    script: text("script").notNull(),
    paramSchema: text("param_schema"), // JSON Schema
    isDestructive: integer("is_destructive").default(0),
    requiresApproval: integer("requires_approval").default(0),
  },
  (t) => [
    uniqueIndex("uq_capability_action").on(t.capabilityId, t.name),
  ]
);

export const projectCapabilities = sqliteTable(
  "project_capabilities",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    capabilityId: text("capability_id")
      .notNull()
      .references(() => capabilities.id),
    credentialsEnc: text("credentials_enc"),
    credentialsIv: text("credentials_iv"),
    credentialsTag: text("credentials_tag"),
    status: text("status").notNull().default("pending"),
    lastTestedAt: text("last_tested_at"),
    lastTestStatus: text("last_test_status"),
    lastTestOutput: text("last_test_output"),
    configuredAt: text("configured_at"),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("uq_pc_project_capability").on(t.projectId, t.capabilityId),
    index("idx_pc_project").on(t.projectId),
  ]
);

// APPEND ONLY.
export const capabilityExecutions = sqliteTable(
  "capability_executions",
  {
    id: text("id").primaryKey(),
    projectCapabilityId: text("project_capability_id")
      .notNull()
      .references(() => projectCapabilities.id),
    actionId: text("action_id")
      .notNull()
      .references(() => capabilityActions.id),
    params: text("params"), // JSON (never credentials)
    triggeredBy: text("triggered_by").notNull(),
    executedAt: text("executed_at").notNull(),
    status: text("status").notNull(),
    output: text("output"),
    error: text("error"),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("idx_executions_pc").on(t.projectCapabilityId, t.executedAt),
  ]
);

export const accountSnapshots = sqliteTable(
  "account_snapshots",
  {
    id: text("id").primaryKey(),
    projectCapabilityId: text("project_capability_id")
      .notNull()
      .references(() => projectCapabilities.id),
    capturedAt: text("captured_at").notNull(),
    trigger: text("trigger").notNull(),
    state: text("state").notNull(), // JSON
    rawResponse: text("raw_response"),
    triggeredByExecution: text("triggered_by_execution").references(
      () => capabilityExecutions.id
    ),
  },
  (t) => [
    index("idx_snapshots_pc").on(t.projectCapabilityId, t.capturedAt),
  ]
);

// ── Tasks ─────────────────────────────────────────────────────────

// IMMUTABLE. No UPDATE. No DELETE.
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    agent: text("agent").notNull(),
    description: text("description").notNull(),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull(), // task_id or 'system'
    claimedAt: text("claimed_at"), // set by loop, cleared on recovery
    inputs: text("inputs").notNull().default("[]"), // JSON: [{name, artifact_id}]
    outputs: text("outputs").notNull().default("[]"), // JSON: [{name, type, isFailure?: boolean}]
  },
  (t) => [
    index("idx_tasks_project").on(t.projectId, t.createdAt),
    index("idx_tasks_agent").on(t.projectId, t.agent),
    index("idx_tasks_claimed").on(t.claimedAt),
  ]
);

// ── Project Configs ───────────────────────────────────────────────

// APPEND ONLY.
export const projectConfigs = sqliteTable(
  "project_configs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    config: text("config").notNull(), // JSON: ProjectConfig
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull(), // 'founder' | 'system'
  },
  (t) => [
    index("idx_project_configs_project").on(t.projectId, t.createdAt),
  ]
);

// ── Artifacts ─────────────────────────────────────────────────────

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    type: text("type").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    content: text("content"),
    contentEncoding: text("content_encoding"),
    blobHash: text("blob_hash"),
    contentSize: integer("content_size").notNull(),
    contentHash: text("content_hash").notNull(),
    metadata: text("metadata"), // JSON
    snapshotOf: text("snapshot_of"),
    supersedes: text("supersedes").references((): ReturnType<typeof text> => artifacts.id),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull(),
    taskId: text("task_id").references(() => tasks.id), // nullable — system/bootstrap artifacts have no task
    outputName: text("output_name"), // nullable
  },
  (t) => [
    index("idx_artifacts_project").on(t.projectId, t.type, t.createdAt),
    index("idx_artifacts_hash").on(t.contentHash),
    index("idx_artifacts_task").on(t.taskId, t.outputName),
    uniqueIndex("uq_artifacts_task_output").on(t.taskId, t.outputName),
    check(
      "content_xor_blob",
      sql`(${t.content} IS NOT NULL) != (${t.blobHash} IS NOT NULL)`
    ),
  ]
);

// ── Onboarding ────────────────────────────────────────────────────

export const onboardingSessions = sqliteTable("onboarding_sessions", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
  projectId: text("project_id").references(() => projects.id),
});

// APPEND ONLY.
export const onboardingMessages = sqliteTable("onboarding_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => onboardingSessions.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  timestamp: text("timestamp").notNull(),
});

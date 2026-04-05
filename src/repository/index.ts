// Public interface — the only thing the rest of the app sees.
// Nothing in here imports drizzle, better-sqlite3, node:crypto, or git.

export type {
  Project,
  ProjectBrief,
  ProjectStatus,
  Decision,
  NewDecision,
  DecisionFilter,
  DecisionDomain,
  DecisionImpact,
  DecisionMadeBy,
  DecisionReversibility,
  Escalation,
  NewEscalation,
  EscalationResolution,
  ActivityEntry,
  ActivityEvent,
  EngineRun,
  EngineRunStatus,
  RunSummary,
  CapabilityDefinition,
  NewCapabilityDefinition,
  CapabilityAction,
  CapabilityActionType,
  CapabilityCategory,
  CapabilityStatus,
  ProjectCapability,
  ExecutionResult,
  CapabilityExecution,
  AccountState,
  Artifact,
  ArtifactWithContent,
  NewArtifact,
  ArtifactType,
  Task,
  NewTask,
  TaskInput,
  TaskOutput,
  TaskState,
  TaskFilter,
  ProjectConfig,
  ProjectConfigHead,
  ProjectConfigTail,
  AgentDefinition,
  DagValidationResult,
} from "./types.js";

export type { RepositoryConfig } from "./config.js";
export { repositoryConfigFromEnv } from "./config.js";

// ── Sub-repository interfaces ─────────────────────────────────────

import type {
  Project,
  ProjectBrief,
  ProjectStatus,
  Decision,
  NewDecision,
  DecisionFilter,
  DecisionDomain,
  Escalation,
  NewEscalation,
  EscalationResolution,
  ActivityEntry,
  ActivityEvent,
  EngineRun,
  RunSummary,
  CapabilityDefinition,
  NewCapabilityDefinition,
  CapabilityAction,
  CapabilityStatus,
  ProjectCapability,
  ExecutionResult,
  CapabilityExecution,
  AccountState,
  Artifact,
  ArtifactWithContent,
  NewArtifact,
  ArtifactType,
  Task,
  NewTask,
  TaskState,
  TaskFilter,
  ProjectConfig,
  DagValidationResult,
} from "./types.js";

export interface IProjectRepository {
  create(brief: ProjectBrief & { name: string; slug: string }): Project;
  get(id: string): Project | null;
  list(status?: ProjectStatus): Project[];
  updateStatus(id: string, status: ProjectStatus): void;
  updateBrief(id: string, brief: ProjectBrief): void;
}

export interface IDecisionRepository {
  append(decision: NewDecision): Decision;
  query(filter: DecisionFilter): Decision[];
  latestPerTopic(projectId: string, domain?: DecisionDomain): Decision[];
  getHistory(projectId: string, topic: string): Decision[];
}

export interface IEscalationRepository {
  create(escalation: NewEscalation): Escalation;
  getOpen(projectId: string): Escalation[];
  get(id: string): Escalation | null;
  resolve(id: string, resolution: EscalationResolution): void;
}

export interface ICapabilityRepository {
  listDefinitions(category?: string): CapabilityDefinition[];
  getDefinition(id: string): CapabilityDefinition | null;
  createDefinition(def: NewCapabilityDefinition): CapabilityDefinition;
  updateDefinition(id: string, updates: Partial<NewCapabilityDefinition>): void;

  listActions(capabilityId: string): CapabilityAction[];
  createAction(
    capabilityId: string,
    action: Omit<CapabilityAction, "id" | "capabilityId">
  ): CapabilityAction;

  addToProject(projectId: string, capabilityId: string): ProjectCapability;
  listForProject(projectId: string): ProjectCapability[];
  getProjectCapability(id: string): ProjectCapability | null;

  saveCredentials(
    projectCapabilityId: string,
    credentials: Record<string, string>
  ): void;
  setStatus(id: string, status: CapabilityStatus, detail?: string): void;

  execute(
    projectCapabilityId: string,
    actionName: string,
    params: Record<string, string>,
    triggeredBy: "agent" | "founder-test"
  ): Promise<ExecutionResult>;

  getExecutionHistory(
    projectCapabilityId: string,
    limit?: number
  ): CapabilityExecution[];
  captureAccountState(
    projectCapabilityId: string,
    trigger: AccountState["trigger"]
  ): Promise<void>;
  getLatestAccountState(projectCapabilityId: string): AccountState | null;
}

export interface IArtifactRepository {
  snapshotCode(
    projectId: string,
    repoPath: string,
    trigger?: string
  ): Promise<Artifact>;
  restoreCode(artifactId: string, targetPath: string): Promise<void>;
  store(item: NewArtifact): Artifact;
  get(artifactId: string): ArtifactWithContent;
  getByTaskOutput(taskId: string, outputName: string): Artifact | null;
  list(projectId: string, type?: ArtifactType): Artifact[];
  latestOfType(projectId: string, type: ArtifactType): Artifact | null;
}

export interface IActivityRepository {
  append(
    projectId: string,
    event: ActivityEvent,
    detail: Record<string, unknown>
  ): ActivityEntry;
  list(projectId: string, limit?: number): ActivityEntry[];
}

export interface ILoopRunRepository {
  start(projectId: string): EngineRun;
  complete(runId: string, summary: RunSummary): void;
  fail(runId: string, error: string): void;
  getCurrent(projectId: string): EngineRun | null;
  getLastCompleted(projectId: string): EngineRun | null;
  recoverStalledRuns(): number;
}

/** @deprecated Use ILoopRunRepository */
export type IEngineRunRepository = ILoopRunRepository;

export interface ITaskRepository {
  create(task: NewTask): Task;
  get(id: string): Task | null;
  findRoutable(projectId: string): Task[];
  claim(taskId: string): void;
  recoverStalledTasks(): number;
  listForProject(projectId: string, filter?: TaskFilter): Task[];
  deriveState(
    task: Task,
    artifactStore: { getByTaskOutput(taskId: string, outputName: string): unknown | null }
  ): TaskState;
}

export interface IProjectConfigRepository {
  get(projectId: string): ProjectConfig | null;
  set(projectId: string, config: ProjectConfig, createdBy: string): ProjectConfig;
  validateDag(config: ProjectConfig): DagValidationResult;
  listVersions(projectId: string): ProjectConfig[];
}

export interface IExecutionRepository {
  list(projectCapabilityId: string, limit?: number): CapabilityExecution[];
}

export interface OnboardingSession {
  id: string;
  createdAt: string;
  completedAt: string | null;
  projectId: string | null;
}

export interface OnboardingMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface IOnboardingRepository {
  createSession(): OnboardingSession;
  getSession(id: string): OnboardingSession | null;
  completeSession(id: string, projectId: string): void;
  appendMessage(sessionId: string, role: "user" | "assistant", content: string): OnboardingMessage;
  getMessages(sessionId: string): OnboardingMessage[];
  listActive(): OnboardingSession[];
}

// ── Top-level types ───────────────────────────────────────────────

export interface BackupOptions {
  path: string;
  compress?: boolean;
  includeBlobs?: boolean;
  verify?: boolean;
}

export interface BackupResult {
  path: string;
  sizeBytes: number;
  durationMs: number;
  checksum: string;
  includes: { database: true; blobs: boolean; blobCount: number };
}

export interface HealthStatus {
  status: "ok" | "degraded" | "error";
  db: { ok: boolean; sizeBytes: number; integrityOk: boolean };
  blobs: { ok: boolean; count: number; totalBytes: number };
  encryption: { ok: boolean };
}

export interface IFoundryRepository {
  readonly projects: IProjectRepository;
  readonly decisions: IDecisionRepository;
  readonly escalations: IEscalationRepository;
  readonly capabilities: ICapabilityRepository;
  readonly artifacts: IArtifactRepository;
  readonly activity: IActivityRepository;
  readonly loopRuns: ILoopRunRepository;
  /** @deprecated Use loopRuns */
  readonly engineRuns: ILoopRunRepository;
  readonly executions: IExecutionRepository;
  readonly onboarding: IOnboardingRepository;
  readonly tasks: ITaskRepository;
  readonly projectConfig: IProjectConfigRepository;

  backup(options: BackupOptions): Promise<BackupResult>;
  healthCheck(): Promise<HealthStatus>;
  close(): Promise<void>;
}

// ── Factory functions ────────────────────────────────────────────
// These are the only place in this file that touch the impl layer.

export async function openRepository(
  config: import("./config.js").RepositoryConfig
): Promise<IFoundryRepository> {
  if (config.encryptionKey.length !== 64) {
    throw new Error("FOUNDRY_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }

  // Run migrations before handing back a live repository
  await runMigrations(config.dbPath);

  const { FoundryRepository } = await import("./impl/index.js");
  return new FoundryRepository(config);
}

export async function restoreRepository(
  backupPath: string,
  targetDir: string,
  encryptionKey: string
): Promise<IFoundryRepository> {
  const { restoreBackup } = await import("./impl/backup.js");
  const { dbPath, blobDir } = await restoreBackup(backupPath, targetDir);
  return openRepository({ dbPath, blobDir, encryptionKey });
}

async function runMigrations(dbPath: string): Promise<void> {
  const BetterSqlite3 = (await import("better-sqlite3")).default;
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const schema = await import("./impl/schema/index.js");

  const sqlite = new BetterSqlite3(dbPath);
  const db = drizzle(sqlite, { schema });

  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");

  // Resolve migrations dir relative to this file
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = join(here, "impl", "schema", "migrations");

  try {
    migrate(db, { migrationsFolder });
  } finally {
    sqlite.close();
  }
}

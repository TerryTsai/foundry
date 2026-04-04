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

export interface IEngineRunRepository {
  start(projectId: string): EngineRun;
  complete(runId: string, summary: RunSummary): void;
  fail(runId: string, error: string): void;
  getCurrent(projectId: string): EngineRun | null;
  getLastCompleted(projectId: string): EngineRun | null;
  recoverStalledRuns(): number;
}

export interface IExecutionRepository {
  list(projectCapabilityId: string, limit?: number): CapabilityExecution[];
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
  readonly engineRuns: IEngineRunRepository;
  readonly executions: IExecutionRepository;

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

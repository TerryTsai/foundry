import { eq, and } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  capabilities,
  capabilityActions,
  projectCapabilities,
  capabilityExecutions,
  accountSnapshots,
} from "../schema/index.js";
import type * as schema from "../schema/index.js";
import { encrypt, decrypt } from "../crypto.js";
import { executeBash, executeHttp } from "../executor.js";
import type {
  CapabilityDefinition,
  NewCapabilityDefinition,
  CapabilityAction,
  CapabilityStatus,
  ProjectCapability,
  CapabilityExecution,
  AccountState,
  ExecutionResult,
  CapabilityCategory,
  CapabilityActionType,
  ExecutionStatus,
} from "../../types.js";

type DB = BetterSQLite3Database<typeof schema>;

export class CapabilityStore {
  constructor(
    private readonly db: DB,
    private readonly encryptionKey: string
  ) {}

  // ── Definitions ───────────────────────────────────────────────

  listDefinitions(category?: string): CapabilityDefinition[] {
    const rows = category
      ? this.db
          .select()
          .from(capabilities)
          .where(eq(capabilities.category, category))
          .all()
      : this.db.select().from(capabilities).all();

    return rows.map(rowToDefinition);
  }

  getDefinition(id: string): CapabilityDefinition | null {
    const row = this.db
      .select()
      .from(capabilities)
      .where(eq(capabilities.id, id))
      .get();
    return row ? rowToDefinition(row) : null;
  }

  createDefinition(def: NewCapabilityDefinition): CapabilityDefinition {
    const id = randomUUID();
    this.db.insert(capabilities).values({
      id,
      name: def.name,
      category: def.category,
      description: def.description,
      setupGuide: def.setupGuide,
      configSchema: JSON.stringify(def.configSchema),
      isBuiltin: def.isBuiltin ? 1 : 0,
      createdAt: new Date().toISOString(),
    }).run();

    return this.getDefinitionOrThrow(id);
  }

  updateDefinition(
    id: string,
    updates: Partial<NewCapabilityDefinition>
  ): void {
    const patch: Partial<typeof capabilities.$inferInsert> = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.category !== undefined) patch.category = updates.category;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.setupGuide !== undefined) patch.setupGuide = updates.setupGuide;
    if (updates.configSchema !== undefined)
      patch.configSchema = JSON.stringify(updates.configSchema);

    this.db.update(capabilities).set(patch).where(eq(capabilities.id, id)).run();
  }

  // ── Actions ──────────────────────────────────────────────────

  listActions(capabilityId: string): CapabilityAction[] {
    const rows = this.db
      .select()
      .from(capabilityActions)
      .where(eq(capabilityActions.capabilityId, capabilityId))
      .all();
    return rows.map(rowToAction);
  }

  createAction(
    capabilityId: string,
    action: Omit<CapabilityAction, "id" | "capabilityId">
  ): CapabilityAction {
    const id = randomUUID();
    this.db.insert(capabilityActions).values({
      id,
      capabilityId,
      name: action.name,
      description: action.description,
      actionType: action.actionType,
      script: action.script,
      paramSchema: action.paramSchema ? JSON.stringify(action.paramSchema) : null,
      isDestructive: action.isDestructive ? 1 : 0,
      requiresApproval: action.requiresApproval ? 1 : 0,
    }).run();

    const row = this.db
      .select()
      .from(capabilityActions)
      .where(eq(capabilityActions.id, id))
      .get();
    if (!row) throw new Error(`Action not found after insert: ${id}`);
    return rowToAction(row);
  }

  // ── Project Capabilities ──────────────────────────────────────

  addToProject(projectId: string, capabilityId: string): ProjectCapability {
    const id = randomUUID();
    this.db.insert(projectCapabilities).values({
      id,
      projectId,
      capabilityId,
      status: "pending",
    }).run();

    return this.getProjectCapabilityOrThrow(id);
  }

  listForProject(projectId: string): ProjectCapability[] {
    const rows = this.db
      .select()
      .from(projectCapabilities)
      .where(eq(projectCapabilities.projectId, projectId))
      .all();
    return rows.map(rowToProjectCapability);
  }

  getProjectCapability(id: string): ProjectCapability | null {
    const row = this.db
      .select()
      .from(projectCapabilities)
      .where(eq(projectCapabilities.id, id))
      .get();
    return row ? rowToProjectCapability(row) : null;
  }

  saveCredentials(
    projectCapabilityId: string,
    credentials: Record<string, string>
  ): void {
    const payload = encrypt(JSON.stringify(credentials), this.encryptionKey);
    this.db
      .update(projectCapabilities)
      .set({
        credentialsEnc: payload.enc,
        credentialsIv: payload.iv,
        credentialsTag: payload.tag,
      })
      .where(eq(projectCapabilities.id, projectCapabilityId))
      .run();
  }

  setStatus(
    id: string,
    status: CapabilityStatus,
    detail?: string
  ): void {
    const patch: Partial<typeof projectCapabilities.$inferInsert> = { status };
    if (detail !== undefined) patch.notes = detail;
    if (status === "active" || status === "configured") {
      patch.configuredAt = new Date().toISOString();
    }
    this.db
      .update(projectCapabilities)
      .set(patch)
      .where(eq(projectCapabilities.id, id))
      .run();
  }

  async execute(
    projectCapabilityId: string,
    actionName: string,
    params: Record<string, string>,
    triggeredBy: "agent" | "founder-test"
  ): Promise<ExecutionResult> {
    const pc = this.getProjectCapabilityOrThrow(projectCapabilityId);
    if (pc.status !== "active") {
      throw new Error(
        `ProjectCapability ${projectCapabilityId} is not active (status: ${pc.status})`
      );
    }

    // Decrypt credentials
    const row = this.db
      .select()
      .from(projectCapabilities)
      .where(eq(projectCapabilities.id, projectCapabilityId))
      .get();
    if (!row) throw new Error(`ProjectCapability not found: ${projectCapabilityId}`);

    let credentials: Record<string, string> = {};
    if (row.credentialsEnc && row.credentialsIv && row.credentialsTag) {
      const plaintext = decrypt(
        { enc: row.credentialsEnc, iv: row.credentialsIv, tag: row.credentialsTag },
        this.encryptionKey
      );
      credentials = JSON.parse(plaintext) as Record<string, string>;
    }

    // Find action
    const action = this.db
      .select()
      .from(capabilityActions)
      .where(
        and(
          eq(capabilityActions.capabilityId, pc.capabilityId),
          eq(capabilityActions.name, actionName)
        )
      )
      .get();

    if (!action) {
      throw new Error(`Action "${actionName}" not found for capability`);
    }

    // Execute
    let result: ExecutionResult;
    const actionType = action.actionType as CapabilityActionType;

    if (actionType === "bash") {
      result = await executeBash({ script: action.script, credentials, params });
    } else if (actionType === "http") {
      result = await executeHttp({ config: action.script, credentials, params });
    } else {
      result = {
        status: "failure",
        output: null,
        error: `Action type "${actionType}" not yet implemented`,
        durationMs: 0,
      };
    }

    // Wipe credentials from memory
    credentials = {};

    // Append to execution log (no credentials)
    const execId = randomUUID();
    this.db.insert(capabilityExecutions).values({
      id: execId,
      projectCapabilityId,
      actionId: action.id,
      params: Object.keys(params).length > 0 ? JSON.stringify(params) : null,
      triggeredBy,
      executedAt: new Date().toISOString(),
      status: result.status,
      output: result.output,
      error: result.error,
      durationMs: result.durationMs,
    }).run();

    return result;
  }

  getExecutionHistory(
    projectCapabilityId: string,
    limit = 50
  ): CapabilityExecution[] {
    const rows = this.db
      .select()
      .from(capabilityExecutions)
      .where(
        eq(capabilityExecutions.projectCapabilityId, projectCapabilityId)
      )
      .limit(limit)
      .all();

    return rows.map(rowToExecution);
  }

  async captureAccountState(
    projectCapabilityId: string,
    trigger: AccountState["trigger"]
  ): Promise<void> {
    // Placeholder — specific implementations per capability type.
    // Stores an empty state record for now.
    this.db.insert(accountSnapshots).values({
      id: randomUUID(),
      projectCapabilityId,
      capturedAt: new Date().toISOString(),
      trigger,
      state: JSON.stringify({}),
    }).run();
  }

  getLatestAccountState(projectCapabilityId: string): AccountState | null {
    const row = this.db
      .select()
      .from(accountSnapshots)
      .where(eq(accountSnapshots.projectCapabilityId, projectCapabilityId))
      .orderBy(accountSnapshots.capturedAt)
      .all()
      .at(-1);

    return row ? rowToAccountState(row) : null;
  }

  private getDefinitionOrThrow(id: string): CapabilityDefinition {
    const d = this.getDefinition(id);
    if (!d) throw new Error(`CapabilityDefinition not found: ${id}`);
    return d;
  }

  private getProjectCapabilityOrThrow(id: string): ProjectCapability {
    const pc = this.getProjectCapability(id);
    if (!pc) throw new Error(`ProjectCapability not found: ${id}`);
    return pc;
  }
}

function rowToAction(
  row: typeof capabilityActions.$inferSelect
): CapabilityAction {
  return {
    id: row.id,
    capabilityId: row.capabilityId,
    name: row.name,
    description: row.description,
    actionType: row.actionType as CapabilityActionType,
    script: row.script,
    paramSchema: row.paramSchema
      ? (JSON.parse(row.paramSchema) as Record<string, unknown>)
      : null,
    isDestructive: row.isDestructive === 1,
    requiresApproval: row.requiresApproval === 1,
  };
}

function rowToDefinition(
  row: typeof capabilities.$inferSelect
): CapabilityDefinition {
  return {
    id: row.id,
    name: row.name,
    category: row.category as CapabilityCategory,
    description: row.description,
    setupGuide: row.setupGuide,
    configSchema: JSON.parse(row.configSchema) as Record<string, unknown>,
    isBuiltin: row.isBuiltin === 1,
    createdAt: row.createdAt,
  };
}

function rowToProjectCapability(
  row: typeof projectCapabilities.$inferSelect
): ProjectCapability {
  return {
    id: row.id,
    projectId: row.projectId,
    capabilityId: row.capabilityId,
    status: row.status as CapabilityStatus,
    lastTestedAt: row.lastTestedAt ?? null,
    lastTestStatus:
      (row.lastTestStatus as "success" | "failure" | null) ?? null,
    lastTestOutput: row.lastTestOutput ?? null,
    configuredAt: row.configuredAt ?? null,
    notes: row.notes ?? null,
  };
}

function rowToExecution(
  row: typeof capabilityExecutions.$inferSelect
): CapabilityExecution {
  return {
    id: row.id,
    projectCapabilityId: row.projectCapabilityId,
    actionId: row.actionId,
    params: row.params
      ? (JSON.parse(row.params) as Record<string, string>)
      : null,
    triggeredBy: row.triggeredBy as "agent" | "founder-test",
    executedAt: row.executedAt,
    status: row.status as ExecutionStatus,
    output: row.output ?? null,
    error: row.error ?? null,
    durationMs: row.durationMs ?? null,
  };
}

function rowToAccountState(
  row: typeof accountSnapshots.$inferSelect
): AccountState {
  return {
    id: row.id,
    projectCapabilityId: row.projectCapabilityId,
    capturedAt: row.capturedAt,
    trigger: row.trigger as AccountState["trigger"],
    state: JSON.parse(row.state) as Record<string, unknown>,
    rawResponse: row.rawResponse ?? null,
    triggeredByExecution: row.triggeredByExecution ?? null,
  };
}

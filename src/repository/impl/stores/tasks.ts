import { eq, and, isNull, isNotNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { tasks, artifacts } from "../schema/index.js";
import type * as schema from "../schema/index.js";
import type {
  Task,
  NewTask,
  TaskInput,
  TaskOutput,
  TaskState,
  TaskFilter,
} from "../../types.js";

type DB = BetterSQLite3Database<typeof schema>;

export class TaskStore {
  constructor(private readonly db: DB) {}

  create(task: NewTask): Task {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.db.insert(tasks).values({
      id,
      projectId: task.projectId,
      agent: task.agent,
      description: task.description,
      createdAt,
      createdBy: task.createdBy,
      claimedAt: null,
      inputs: JSON.stringify(task.inputs),
      outputs: JSON.stringify(task.outputs),
    }).run();

    return this.getOrThrow(id);
  }

  get(id: string): Task | null {
    const row = this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .get();

    return row ? rowToTask(row) : null;
  }

  findRoutable(projectId: string): Task[] {
    // Get all unclaimed tasks for this project
    const unclaimed = this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.claimedAt)))
      .all();

    const routable: Task[] = [];

    for (const row of unclaimed) {
      const task = rowToTask(row);

      // Check that all input artifact_ids exist
      const allInputsPresent = task.inputs.every((input) => {
        const artifact = this.db
          .select()
          .from(artifacts)
          .where(eq(artifacts.id, input.artifact_id))
          .get();
        return artifact !== undefined;
      });

      if (!allInputsPresent) continue;

      // Check that no output artifact exists for this task yet
      const hasAnyOutput = task.outputs.some((output) => {
        const artifact = this.db
          .select()
          .from(artifacts)
          .where(
            and(
              eq(artifacts.taskId, task.id),
              eq(artifacts.outputName, output.name)
            )
          )
          .get();
        return artifact !== undefined;
      });

      if (hasAnyOutput) continue;

      routable.push(task);
    }

    return routable;
  }

  claim(taskId: string): void {
    this.db
      .update(tasks)
      .set({ claimedAt: new Date().toISOString() })
      .where(eq(tasks.id, taskId))
      .run();
  }

  recoverStalledTasks(): number {
    // Find tasks that are claimed but have no output artifacts
    const claimed = this.db
      .select()
      .from(tasks)
      .where(isNotNull(tasks.claimedAt))
      .all();

    let count = 0;

    for (const row of claimed) {
      const task = rowToTask(row);

      const hasAnyOutput = task.outputs.some((output) => {
        const artifact = this.db
          .select()
          .from(artifacts)
          .where(
            and(
              eq(artifacts.taskId, task.id),
              eq(artifacts.outputName, output.name)
            )
          )
          .get();
        return artifact !== undefined;
      });

      if (!hasAnyOutput) {
        this.db
          .update(tasks)
          .set({ claimedAt: null })
          .where(eq(tasks.id, task.id))
          .run();
        count++;
      }
    }

    return count;
  }

  listForProject(projectId: string, filter?: TaskFilter): Task[] {
    const rows = this.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .all();

    let result = rows.map(rowToTask);

    if (filter?.agent !== undefined) {
      const agent = filter.agent;
      result = result.filter((t) => t.agent === agent);
    }

    if (filter?.state !== undefined) {
      const state = filter.state;
      result = result.filter((t) => {
        const derived = this.deriveState(t, {
          getByTaskOutput: (tid, outputName) => {
            return this.db
              .select()
              .from(artifacts)
              .where(
                and(
                  eq(artifacts.taskId, tid),
                  eq(artifacts.outputName, outputName)
                )
              )
              .get() ?? null;
          },
        });
        return derived === state;
      });
    }

    return result;
  }

  deriveState(
    task: Task,
    artifactStore: { getByTaskOutput(taskId: string, outputName: string): unknown | null }
  ): TaskState {
    if (task.outputs.length === 0) {
      // No outputs defined: classify by claimed state
      if (task.claimedAt !== null) return "running";
      return "pending";
    }

    const outputStatuses = task.outputs.map((output) => {
      const artifact = artifactStore.getByTaskOutput(task.id, output.name);
      return { output, written: artifact !== null };
    });

    // Any failure output has been written → failed
    const hasWrittenFailure = outputStatuses.some(
      ({ output, written }) => output.isFailure === true && written
    );
    if (hasWrittenFailure) return "failed";

    // All non-failure outputs have been written → complete
    const successOutputs = outputStatuses.filter(
      ({ output }) => output.isFailure !== true
    );
    const allSuccessWritten =
      successOutputs.length > 0 && successOutputs.every(({ written }) => written);
    if (allSuccessWritten) return "complete";

    // Has been claimed but no outputs yet → running
    if (task.claimedAt !== null) return "running";

    // Not claimed, no outputs → pending
    return "pending";
  }

  private getOrThrow(id: string): Task {
    const row = this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .get();
    if (!row) throw new Error(`Task not found: ${id}`);
    return rowToTask(row);
  }
}

function rowToTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    agent: row.agent,
    description: row.description,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    claimedAt: row.claimedAt ?? null,
    inputs: JSON.parse(row.inputs) as TaskInput[],
    outputs: JSON.parse(row.outputs) as TaskOutput[],
  };
}

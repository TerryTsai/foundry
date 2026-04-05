import { eq, and, desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifacts } from "../schema/index.js";
import type * as schema from "../schema/index.js";
import { BlobStore } from "../blob-store.js";
import { createBundle, restoreBundle } from "../git.js";
import { readFileSync, unlinkSync } from "node:fs";
import type {
  Artifact,
  ArtifactWithContent,
  NewArtifact,
  ArtifactType,
} from "../../types.js";

type DB = BetterSQLite3Database<typeof schema>;

export class ArtifactStore {
  private readonly thresholdBytes: number;

  constructor(
    private readonly db: DB,
    private readonly blobs: BlobStore,
    thresholdMb: number
  ) {
    this.thresholdBytes = thresholdMb * 1024 * 1024;
  }

  snapshotCode(
    projectId: string,
    repoPath: string,
    trigger = "manual"
  ): Promise<Artifact> {
    const bundlePath = join(tmpdir(), `foundry-bundle-${randomUUID()}.bundle`);

    return createBundle(repoPath, bundlePath)
      .then(() => {
        const raw = readFileSync(bundlePath);
        try { unlinkSync(bundlePath); } catch { /* ignore */ }

        return this.store({
          projectId,
          type: "git-bundle",
          name: `Code snapshot — ${trigger} ${new Date().toISOString()}`,
          description: `Git bundle: trigger=${trigger}`,
          content: raw,
          metadata: { trigger, repoPath },
          snapshotOf: repoPath,
          createdBy: "system",
        });
      });
  }

  async restoreCode(artifactId: string, targetPath: string): Promise<void> {
    const artifact = await this.get(artifactId);
    const bundlePath = join(tmpdir(), `foundry-restore-${randomUUID()}.bundle`);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(bundlePath, artifact.content);
    try {
      await restoreBundle(bundlePath, targetPath);
    } finally {
      try { unlinkSync(bundlePath); } catch { /* ignore */ }
    }
  }

  store(item: NewArtifact): Artifact {
    // Idempotent: if taskId + outputName both set, use INSERT OR IGNORE and return existing if duplicate
    const hasTaskOutput = item.taskId !== undefined && item.outputName !== undefined;

    if (hasTaskOutput) {
      // Check for existing artifact with this task+output first
      const existing = this.getByTaskOutput(item.taskId as string, item.outputName as string);
      if (existing !== null) {
        return existing;
      }
    }

    const id = randomUUID();
    const raw =
      typeof item.content === "string"
        ? Buffer.from(item.content, "utf8")
        : item.content;

    const contentSize = raw.length;
    const contentHash = createHash("sha256").update(raw).digest("hex");

    let content: string | null = null;
    let contentEncoding: string | null = null;
    let blobHash: string | null = null;

    if (contentSize > this.thresholdBytes) {
      // Route to blob store
      blobHash = this.blobs.put(raw);
    } else {
      // Inline with gzip
      const compressed = gzipSync(raw);
      content = compressed.toString("base64");
      contentEncoding = "gzip+base64";
    }

    this.db.insert(artifacts).values({
      id,
      projectId: item.projectId,
      type: item.type,
      name: item.name,
      description: item.description ?? null,
      content,
      contentEncoding,
      blobHash,
      contentSize,
      contentHash,
      metadata: item.metadata ? JSON.stringify(item.metadata) : null,
      snapshotOf: item.snapshotOf ?? null,
      supersedes: item.supersedes ?? null,
      createdAt: new Date().toISOString(),
      createdBy: item.createdBy,
      ...(item.taskId !== undefined && { taskId: item.taskId }),
      ...(item.outputName !== undefined && { outputName: item.outputName }),
    }).run();

    return this.getMetaOrThrow(id);
  }

  get(artifactId: string): ArtifactWithContent {
    const row = this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, artifactId))
      .get();
    if (!row) throw new Error(`Artifact not found: ${artifactId}`);

    let content: Buffer;
    if (row.blobHash) {
      content = this.blobs.get(row.blobHash);
    } else if (row.content && row.contentEncoding === "gzip+base64") {
      content = gunzipSync(Buffer.from(row.content, "base64"));
    } else if (row.content) {
      content = Buffer.from(row.content, "utf8");
    } else {
      throw new Error(`Artifact ${artifactId} has no content`);
    }

    return { ...rowToArtifact(row), content };
  }

  getByTaskOutput(taskId: string, outputName: string): Artifact | null {
    const row = this.db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.taskId, taskId),
          eq(artifacts.outputName, outputName)
        )
      )
      .get();

    return row ? rowToArtifact(row) : null;
  }

  list(projectId: string, type?: ArtifactType): Artifact[] {
    const rows = type
      ? this.db
          .select()
          .from(artifacts)
          .where(and(eq(artifacts.projectId, projectId), eq(artifacts.type, type)))
          .orderBy(desc(artifacts.createdAt))
          .all()
      : this.db
          .select()
          .from(artifacts)
          .where(eq(artifacts.projectId, projectId))
          .orderBy(desc(artifacts.createdAt))
          .all();

    return rows.map(rowToArtifact);
  }

  latestOfType(projectId: string, type: ArtifactType): Artifact | null {
    const row = this.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.projectId, projectId), eq(artifacts.type, type)))
      .orderBy(desc(artifacts.createdAt))
      .limit(1)
      .get();

    return row ? rowToArtifact(row) : null;
  }

  private getMetaOrThrow(id: string): Artifact {
    const row = this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, id))
      .get();
    if (!row) throw new Error(`Artifact not found: ${id}`);
    return rowToArtifact(row);
  }
}

function rowToArtifact(row: typeof artifacts.$inferSelect): Artifact {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type as ArtifactType,
    name: row.name,
    description: row.description ?? null,
    contentSize: row.contentSize,
    contentHash: row.contentHash,
    metadata: row.metadata
      ? (JSON.parse(row.metadata) as Record<string, unknown>)
      : null,
    snapshotOf: row.snapshotOf ?? null,
    supersedes: row.supersedes ?? null,
    createdAt: row.createdAt,
    createdBy: row.createdBy as "agent" | "founder" | "system",
    taskId: row.taskId ?? null,
    outputName: row.outputName ?? null,
  };
}

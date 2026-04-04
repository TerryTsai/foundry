import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  statSync,
  readFileSync,
  cpSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import * as tar from "tar";
import type Database from "better-sqlite3";
import type { BackupOptions, BackupResult } from "../index.js";

export async function createBackup(
  db: Database.Database,
  blobDir: string,
  options: BackupOptions
): Promise<BackupResult> {
  const start = Date.now();
  const compress = options.compress ?? true;
  const includeBlobs = options.includeBlobs ?? true;
  const verify = options.verify ?? true;

  // Build a staging directory with a clean layout
  const stagingDir = join(tmpdir(), `foundry-backup-${randomUUID()}`);
  mkdirSync(stagingDir, { recursive: true });

  try {
    // Step 1: Online backup via better-sqlite3 .backup()
    const stagedDbPath = join(stagingDir, "foundry.db");
    await db.backup(stagedDbPath);

    // Step 2: Copy blob store if requested
    let blobCount = 0;
    if (includeBlobs && existsSync(blobDir)) {
      const stagedBlobDir = join(stagingDir, "foundry.blobs");
      cpSync(blobDir, stagedBlobDir, { recursive: true });
      blobCount = countFiles(stagedBlobDir);
    }

    // Step 3: Create archive from staging dir
    const outPath = options.path;
    mkdirSync(dirname(outPath), { recursive: true });

    const entries = readdirSync(stagingDir);
    await tar.create({ gzip: compress, file: outPath, cwd: stagingDir }, entries);

    // Step 4: Checksum the archive
    const archiveBytes = readFileSync(outPath);
    const checksum = createHash("sha256").update(archiveBytes).digest("hex");
    const sizeBytes = archiveBytes.length;

    // Step 5: Optional integrity verify
    if (verify) {
      const verifyDir = join(tmpdir(), `foundry-verify-${randomUUID()}`);
      mkdirSync(verifyDir, { recursive: true });
      try {
        await tar.extract({ file: outPath, cwd: verifyDir });

        const BetterSqlite3 = (await import("better-sqlite3")).default;
        const verifyDb = new BetterSqlite3(join(verifyDir, "foundry.db"), {
          readonly: true,
        });
        const result = verifyDb.pragma("integrity_check") as Array<{
          integrity_check: string;
        }>;
        verifyDb.close();

        if (result[0]?.integrity_check !== "ok") {
          throw new Error(
            `Backup integrity check failed: ${result[0]?.integrity_check}`
          );
        }
      } finally {
        try { rmSync(verifyDir, { recursive: true }); } catch { /* ignore */ }
      }
    }

    return {
      path: outPath,
      sizeBytes,
      durationMs: Date.now() - start,
      checksum,
      includes: { database: true, blobs: includeBlobs, blobCount },
    };
  } finally {
    try { rmSync(stagingDir, { recursive: true }); } catch { /* ignore */ }
  }
}

export async function restoreBackup(
  archivePath: string,
  targetDir: string
): Promise<{ dbPath: string; blobDir: string }> {
  mkdirSync(targetDir, { recursive: true });
  await tar.extract({ file: archivePath, cwd: targetDir });

  const dbPath = join(targetDir, "foundry.db");
  if (!existsSync(dbPath)) {
    throw new Error(`Restore failed: foundry.db not found in archive`);
  }

  const BetterSqlite3 = (await import("better-sqlite3")).default;
  const db = new BetterSqlite3(dbPath, { readonly: true });
  const result = db.pragma("integrity_check") as Array<{
    integrity_check: string;
  }>;
  db.close();

  if (result[0]?.integrity_check !== "ok") {
    throw new Error(
      `Restored DB failed integrity check: ${result[0]?.integrity_check}`
    );
  }

  return {
    dbPath,
    blobDir: join(targetDir, "foundry.blobs"),
  };
}

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      count += countFiles(full);
    } else {
      count++;
    }
  }
  return count;
}

export interface RepositoryConfig {
  dbPath: string;
  blobDir: string;
  encryptionKey: string;
  blobThresholdMb?: number; // default 50
}

export function repositoryConfigFromEnv(): RepositoryConfig {
  const dbPath = process.env["DB_PATH"];
  const blobDir = process.env["BLOB_DIR"];
  const encryptionKey = process.env["FOUNDRY_ENCRYPTION_KEY"];

  if (!dbPath) throw new Error("DB_PATH is required");
  if (!blobDir) throw new Error("BLOB_DIR is required");
  if (!encryptionKey) throw new Error("FOUNDRY_ENCRYPTION_KEY is required");
  if (encryptionKey.length !== 64)
    throw new Error(
      "FOUNDRY_ENCRYPTION_KEY must be 64 hex characters (32 bytes)"
    );

  return {
    dbPath,
    blobDir,
    encryptionKey,
    blobThresholdMb: process.env["BLOB_THRESHOLD_MB"]
      ? parseInt(process.env["BLOB_THRESHOLD_MB"], 10)
      : 50,
  };
}

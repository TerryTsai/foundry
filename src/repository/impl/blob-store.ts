import { createHash } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

export class BlobStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  put(content: Buffer): string {
    const hash = sha256(content);
    const dest = this.pathFor(hash);

    if (!existsSync(dest)) {
      mkdirSync(join(this.dir, hash.slice(0, 2)), { recursive: true });
      writeFileSync(dest, content);
    }

    return hash;
  }

  get(hash: string): Buffer {
    const p = this.pathFor(hash);
    if (!existsSync(p)) throw new Error(`Blob not found: ${hash}`);
    return readFileSync(p);
  }

  has(hash: string): boolean {
    return existsSync(this.pathFor(hash));
  }

  stats(): { count: number; totalBytes: number } {
    let count = 0;
    let totalBytes = 0;

    if (!existsSync(this.dir)) return { count, totalBytes };

    for (const prefix of readdirSync(this.dir)) {
      const prefixPath = join(this.dir, prefix);
      if (!statSync(prefixPath).isDirectory()) continue;
      for (const file of readdirSync(prefixPath)) {
        count++;
        totalBytes += statSync(join(prefixPath, file)).size;
      }
    }

    return { count, totalBytes };
  }

  private pathFor(hash: string): string {
    return join(this.dir, hash.slice(0, 2), hash);
  }
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256")
    .update(data)
    .digest("hex");
}

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function createBundle(repoPath: string, outputPath: string): Promise<void> {
  mkdirSync(dirname(outputPath), { recursive: true });
  return run("git", ["bundle", "create", outputPath, "--all"], repoPath);
}

export function restoreBundle(bundlePath: string, targetPath: string): Promise<void> {
  mkdirSync(targetPath, { recursive: true });
  return run("git", ["clone", bundlePath, targetPath], process.cwd());
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

    const stderr: Buffer[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${cmd} ${args[0]} exited ${code}: ${Buffer.concat(stderr).toString().trim()}`
          )
        );
      }
    });

    proc.on("error", reject);
  });
}

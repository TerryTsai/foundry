import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ExecutionResult } from "../types.js";

const MAX_OUTPUT_BYTES = 4 * 1024; // 4KB

interface BashAction {
  script: string;
  credentials: Record<string, string>;
  params: Record<string, string>;
}

interface HttpAction {
  config: string; // JSON template
  credentials: Record<string, string>;
  params: Record<string, string>;
}

export async function executeBash(action: BashAction): Promise<ExecutionResult> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };

  for (const [k, v] of Object.entries(action.credentials)) {
    env[`CRED_${k.toUpperCase()}`] = v;
  }
  for (const [k, v] of Object.entries(action.params)) {
    env[`PARAM_${k.toUpperCase()}`] = v;
  }

  const scriptPath = join(tmpdir(), `foundry-action-${randomUUID()}.sh`);
  writeFileSync(scriptPath, action.script, { mode: 0o700 });

  const start = Date.now();
  try {
    return await runScript("bash", [scriptPath], env, start);
  } finally {
    try { unlinkSync(scriptPath); } catch { /* ignore */ }
    // Wipe credentials from env object (belt-and-suspenders)
    for (const k of Object.keys(action.credentials)) {
      delete env[`CRED_${k.toUpperCase()}`];
    }
  }
}

export async function executeHttp(action: HttpAction): Promise<ExecutionResult> {
  const start = Date.now();
  try {
    const config = interpolateTemplate(
      action.config,
      action.credentials,
      action.params
    );
    const parsed = JSON.parse(config) as {
      method: string;
      url: string;
      headers?: Record<string, string>;
      body?: unknown;
    };

    const fetchInit: RequestInit = {
      method: parsed.method,
    };
    if (parsed.headers) fetchInit.headers = parsed.headers;
    if (parsed.body != null) fetchInit.body = JSON.stringify(parsed.body);

    const response = await fetch(parsed.url, fetchInit);

    const text = await response.text();
    const durationMs = Date.now() - start;
    const truncated = text.slice(0, MAX_OUTPUT_BYTES);

    if (response.ok) {
      return { status: "success", output: truncated, error: null, durationMs };
    } else {
      return {
        status: "failure",
        output: null,
        error: `HTTP ${response.status}: ${truncated}`,
        durationMs,
      };
    }
  } catch (err) {
    return {
      status: "failure",
      output: null,
      error: String(err),
      durationMs: Date.now() - start,
    };
  }
}

function interpolateTemplate(
  template: string,
  credentials: Record<string, string>,
  params: Record<string, string>
): string {
  let result = template;
  for (const [k, v] of Object.entries(credentials)) {
    result = result.replaceAll(`{{CRED_${k.toUpperCase()}}}`, v);
  }
  for (const [k, v] of Object.entries(params)) {
    result = result.replaceAll(`{{PARAM_${k.toUpperCase()}}}`, v);
  }
  return result;
}

function runScript(
  cmd: string,
  args: string[],
  env: Record<string, string>,
  start: number
): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    proc.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    proc.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

    proc.on("close", (code) => {
      const durationMs = Date.now() - start;
      const out = Buffer.concat(stdout).toString().slice(0, MAX_OUTPUT_BYTES) || null;
      const err = Buffer.concat(stderr).toString().slice(0, MAX_OUTPUT_BYTES) || null;

      resolve({
        status: code === 0 ? "success" : "failure",
        output: out,
        error: err,
        durationMs,
      });
    });

    proc.on("error", (err) => {
      resolve({
        status: "failure",
        output: null,
        error: String(err),
        durationMs: Date.now() - start,
      });
    });
  });
}

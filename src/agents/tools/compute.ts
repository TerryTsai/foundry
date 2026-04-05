// Compute tools: run_command, read_file, write_file
// All scoped to config.workspace — paths validated to stay within it.

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { join, resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const COMMAND_TIMEOUT_MS = 300_000; // 5 minutes

function validatePath(workspace: string, userPath: string): string | null {
  const resolved = resolve(join(workspace, userPath));
  if (resolved !== workspace && !resolved.startsWith(workspace + '/')) {
    return null;
  }
  return resolved;
}

export function buildComputeTools(workspace: string) {
  const runCommand = tool(
    'run_command',
    'Run a shell command in the workspace. cwd is relative to workspace root.',
    {
      command: z.string().describe('The command to run'),
      cwd: z.string().optional().describe('Working directory relative to workspace (default: workspace root)'),
    },
    async (args) => {
      try {
        let effectiveCwd = workspace;
        if (args.cwd !== undefined && args.cwd !== '') {
          const validated = validatePath(workspace, args.cwd);
          if (!validated) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ error: 'Path outside workspace' }),
                },
              ],
            };
          }
          effectiveCwd = validated;
        }

        const start = Date.now();
        const result = spawnSync('sh', ['-c', args.command], {
          cwd: effectiveCwd,
          timeout: COMMAND_TIMEOUT_MS,
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
        });

        const duration_ms = Date.now() - start;

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                stdout: result.stdout ?? '',
                stderr: result.stderr ?? '',
                exit_code: result.status ?? -1,
                duration_ms,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
        };
      }
    },
  );

  const readFile = tool(
    'read_file',
    'Read a file from the workspace. Path is relative to workspace root.',
    {
      path: z.string().describe('File path relative to workspace root'),
    },
    async (args) => {
      try {
        const validated = validatePath(workspace, args.path);
        if (!validated) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: 'Path outside workspace' }),
              },
            ],
          };
        }

        const content = readFileSync(validated, 'utf8');
        const stat = statSync(validated);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                content,
                size_bytes: stat.size,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
        };
      }
    },
  );

  const writeFile = tool(
    'write_file',
    'Write a file to the workspace. Path is relative to workspace root. Creates intermediate directories.',
    {
      path: z.string().describe('File path relative to workspace root'),
      content: z.string().describe('Content to write'),
    },
    async (args) => {
      try {
        const validated = validatePath(workspace, args.path);
        if (!validated) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: 'Path outside workspace' }),
              },
            ],
          };
        }

        // Create parent directories if needed
        const parentDir = validated.slice(0, validated.lastIndexOf('/'));
        if (parentDir) {
          mkdirSync(parentDir, { recursive: true });
        }

        writeFileSync(validated, args.content, 'utf8');
        const stat = statSync(validated);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                path: args.path,
                size_bytes: stat.size,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
        };
      }
    },
  );

  return { runCommand, readFile, writeFile };
}

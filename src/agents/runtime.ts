// Agent runtime: opens a Claude SDK session for a given agent context.

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { IFoundryRepository } from '../repository/index.js';
import type { AgentContext } from './context.js';
import { buildToolServer } from './context.js';

export async function runAgentSession(
  context: AgentContext,
  repo: IFoundryRepository,
): Promise<void> {
  const toolServer = buildToolServer(context, repo);

  const q = query({
    prompt: context.initialPrompt,
    options: {
      systemPrompt: context.systemPrompt,
      mcpServers: { foundry: toolServer.mcpConfig },
      tools: [],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 50,
      persistSession: false,
    },
  });

  for await (const message of q) {
    if (message.type === 'result') {
      if (message.subtype !== 'success') {
        throw new Error(
          `Agent session ended with non-success: ${message.subtype}` +
          ('errors' in message ? ` — ${(message.errors as string[]).join('; ')}` : ''),
        );
      }
      break;
    }
  }
}

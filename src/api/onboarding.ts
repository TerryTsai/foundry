import { Router } from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { IFoundryRepository } from "../repository/index.js";

const SYSTEM_PROMPT = `You are an onboarding assistant for Foundry — an autonomous project engine for solo founders.

Your job is to conduct a focused interview and produce a structured product brief. You need to understand:
- What the project is and its core tagline
- The problem being solved
- Who the target user is
- What the MVP looks like
- Key constraints (technical, time, resources)
- What already exists (prior work, competitors, references)
- Any assumptions the founder is making

Guidelines:
- Ask at most one question per response. Never ask two questions in one message.
- Be direct and specific — ask for concrete details, not generalities.
- State assumptions rather than ask about low-stakes details.
- If an answer is vague and materially affects the brief, follow up once.
- When you have enough to write a solid brief (typically 5–8 exchanges), output it.
- Keep your messages short. This is a conversation, not an essay.

When ready to produce the brief, output it as XML inside <brief> tags, embedded in your response:

<brief>
  <n>Project name</n>
  <tagline>One-sentence description</tagline>
  <problem>The problem being solved</problem>
  <user>Who the target user is</user>
  <mvp>What the minimum viable product looks like</mvp>
  <constraints>Key constraints</constraints>
  <existing>Prior work, existing implementations, or relevant context</existing>
  <assumptions>
    <assumption>Each key assumption on its own line</assumption>
  </assumptions>
</brief>

After outputting the brief, ask the founder to review and approve it, or let you know what to change.`;

export function buildOnboardingRouter(repo: IFoundryRepository): Router {
  const router = Router();

  // POST /api/onboarding/sessions — start a new session
  router.post("/sessions", (req, res) => {
    try {
      const session = repo.onboarding.createSession();
      // Send the opening message
      const opening: string = "What are you building?";
      repo.onboarding.appendMessage(session.id, "assistant", opening);
      res.status(201).json({ session, messages: [{ role: "assistant", content: opening, id: "opening" }] });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/onboarding/sessions/:id
  router.get("/sessions/:id", (req, res) => {
    try {
      const session = repo.onboarding.getSession(req.params["id"]!);
      if (!session) { res.status(404).json({ error: "Session not found" }); return; }
      const messages = repo.onboarding.getMessages(req.params["id"]!);
      res.json({ session, messages });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/onboarding/sessions — list active sessions
  router.get("/sessions", (_req, res) => {
    try {
      res.json(repo.onboarding.listActive());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/onboarding/sessions/:id/message — send a user message, get AI reply
  router.post("/sessions/:id/message", async (req, res) => {
    try {
      const sessionId = req.params["id"]!;
      const session = repo.onboarding.getSession(sessionId);
      if (!session) { res.status(404).json({ error: "Session not found" }); return; }
      if (session.completedAt) { res.status(409).json({ error: "Session already completed" }); return; }

      const { content } = req.body as { content?: string };
      if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }

      // Save user message
      repo.onboarding.appendMessage(sessionId, "user", content.trim());

      // Load all messages to reconstruct conversation for Claude
      const history = repo.onboarding.getMessages(sessionId);

      // Build a prompt that includes the full conversation history.
      // Claude gets the history as a formatted transcript and must respond
      // as the onboarding assistant to the latest user message.
      const transcript = history
        .map((m) => `${m.role === "user" ? "Founder" : "Assistant"}: ${m.content}`)
        .join("\n\n");

      const prompt = `${transcript}\n\nAssistant:`;

      // Run one turn via the Agent SDK (Claude Max auth, no built-in tools)
      let assistantReply = "";

      const q = query({
        prompt,
        options: {
          systemPrompt: SYSTEM_PROMPT,
          tools: [],
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          maxTurns: 1,
          persistSession: false,
        },
      });

      for await (const msg of q) {
        if (msg.type === "result" && msg.subtype === "success") {
          assistantReply = msg.result.trim();
          break;
        }
        if (msg.type === "result") {
          throw new Error(`Claude error: ${msg.subtype}`);
        }
      }

      if (!assistantReply) throw new Error("No reply from Claude");

      // Save assistant reply
      const saved = repo.onboarding.appendMessage(sessionId, "assistant", assistantReply);

      res.json({ message: saved });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/projects — create project from approved brief
  router.post("/approve", async (req, res) => {
    try {
      const { sessionId, brief } = req.body as {
        sessionId?: string;
        brief?: {
          name: string;
          tagline: string;
          problem: string;
          user: string;
          mvp: string;
          constraints: string;
          existing: string;
          assumptions: string[];
        };
      };

      if (!brief?.name || !brief.tagline) {
        res.status(400).json({ error: "brief with name and tagline is required" });
        return;
      }

      const { seedCapabilities } = await import("../engine/seed.js");
      await seedCapabilities(repo);

      const project = repo.projects.create({
        name: brief.name,
        slug: brief.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        tagline: brief.tagline,
        problem: brief.problem ?? "",
        user: brief.user ?? "",
        mvp: brief.mvp ?? "",
        constraints: brief.constraints ?? "",
        existing: brief.existing ?? "",
        assumptions: brief.assumptions ?? [],
      });

      if (sessionId) {
        const session = repo.onboarding.getSession(sessionId);
        if (session && !session.completedAt) {
          repo.onboarding.completeSession(sessionId, project.id);
        }
      }

      res.status(201).json(project);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}

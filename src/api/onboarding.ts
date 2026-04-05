import { Router } from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { IFoundryRepository } from "../repository/index.js";
import type { AgentDefinition, ProjectConfigTail } from "../repository/types.js";

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

When you have enough context to suggest an initial agent workforce, output a config block.

Each agent's "prompt" field is its complete system prompt — write it as a full, specific paragraph that tells the agent exactly what it does, what artifacts it should read, what it should produce, and how to decide when to call create_task vs write_artifact. Make prompts specific to this project.

Example strategist prompt: "You are the strategist for SnapQuery, a data-exploration tool. When given a brief, read it carefully and decompose the MVP into concrete engineering tasks. For each task, call create_task with the appropriate agent (coder, deployer), a clear description, and the right input artifact ids. Produce a task_graph artifact summarizing the plan. If you encounter a major architectural decision, write a decision artifact explaining your choice."

Example coder prompt: "You are the coder for SnapQuery. You receive tasks describing features to implement. Read the relevant brief or prior code artifacts, then use run_command and write_file to implement the feature in /home/terry/projects/snapquery. When done, write a code_artifact with the path and a summary."

<config>
{
  "workspace": "/home/terry/projects/{project-slug}",
  "agents": [
    {
      "name": "strategist",
      "consumes": ["brief", "decision"],
      "produces": ["decision", "task_graph"],
      "tools": ["read_artifact", "write_artifact", "create_task"],
      "prompt": "You are the strategist for {ProjectName}. Read the brief, then decompose the MVP into concrete, ordered tasks. For each task call create_task with the appropriate agent name, a clear description, and the brief artifact_id as input. When all tasks are dispatched, write a task_graph artifact (name: task_graph, type: task_graph) summarizing the plan as JSON with fields: phases (array of {phase, tasks: [description]}). If you face a major architectural fork, write a decision artifact first and pass its artifact_id to affected tasks."
    },
    {
      "name": "coder",
      "consumes": ["task_graph", "decision", "code_artifact"],
      "produces": ["code_artifact"],
      "tools": ["read_artifact", "write_artifact", "run_command", "read_file", "write_file"],
      "prompt": "You are the coder for {ProjectName}. Read the task description and input artifacts. Implement the feature in the project workspace using run_command and write_file. When done, write a code_artifact (name matching the task output, type: code_artifact) summarizing what was implemented and which files were changed."
    },
    {
      "name": "deployer",
      "consumes": ["code_artifact"],
      "produces": ["environment"],
      "tools": ["read_artifact", "write_artifact", "run_command"],
      "prompt": "You are the deployer for {ProjectName}. Read the code_artifact, then run deployment commands in the workspace. Write an environment artifact (name: deployed_app, type: environment) with the deployment URL and status."
    },
    {
      "name": "founder",
      "consumes": ["*"],
      "produces": ["*"],
      "tools": [],
      "prompt": null
    }
  ],
  "tail": [
    { "name": "deployed_app", "type": "environment" }
  ]
}
</config>

RULES:
- Every type in "tail" MUST appear in the "produces" array of at least one non-founder agent.
- Always include a 'founder' agent exactly as shown (consumes: ["*"], produces: ["*"], tools: [], prompt: null).
- Tailor the agent list to the project — add a marketer, writer, researcher, etc. as needed.
- Replace {ProjectName} in prompts with the actual project name.
- Write prompts as complete instructions, not placeholders.

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

  // POST /api/onboarding/approve — create project from approved brief + config
  router.post("/approve", async (req, res) => {
    try {
      const { sessionId, brief, config } = req.body as {
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
        config?: {
          workspace: string;
          agents: AgentDefinition[];
          tail: ProjectConfigTail[];
        };
      };

      if (!brief?.name || !brief.tagline) {
        res.status(400).json({ error: "brief with name and tagline is required" });
        return;
      }

      if (!config?.workspace || !Array.isArray(config.agents) || !Array.isArray(config.tail)) {
        res.status(400).json({ error: "config with workspace, agents, and tail is required" });
        return;
      }

      // Validate the DAG before creating anything — pass a placeholder head for validation
      const configForValidation = {
        workspace: config.workspace,
        agents: config.agents,
        tail: config.tail,
        head: [{ name: "brief", type: "brief", artifact_id: "placeholder" }],
      };
      const dagResult = repo.projectConfig.validateDag(configForValidation);
      if (!dagResult.valid) {
        const problems: string[] = [];
        if (dagResult.unreachableTail.length > 0)
          problems.push(`Unreachable tail: ${dagResult.unreachableTail.join(", ")}`);
        if (dagResult.missingProducers.length > 0)
          problems.push(`No agent produces: ${dagResult.missingProducers.join(", ")}`);
        if (dagResult.orphanedAgents.length > 0)
          problems.push(`Orphaned agents (no inputs reachable): ${dagResult.orphanedAgents.join(", ")}`);
        res.status(400).json({ error: `Invalid agent config: ${problems.join("; ")}`, dag: dagResult });
        return;
      }

      const { seedCapabilities } = await import("../capabilities/seed.js");
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

      // Write the brief as a bootstrap artifact
      const briefArtifact = repo.artifacts.store({
        projectId: project.id,
        type: "brief",
        name: "brief",
        content: JSON.stringify(brief),
        createdBy: "system",
      });

      // Build the full config with head pointing to the brief artifact
      const fullConfig = {
        ...config,
        head: [{ name: "brief", type: "brief", artifact_id: briefArtifact.id }],
      };

      // Save the project config
      repo.projectConfig.set(project.id, fullConfig, "founder");

      // Create the bootstrap strategist task
      repo.tasks.create({
        projectId: project.id,
        agent: "strategist",
        description: "Analyze the project brief and produce an initial task graph",
        createdBy: "system",
        inputs: [{ name: "brief", artifact_id: briefArtifact.id }],
        outputs: [{ name: "task_graph", type: "task_graph" }],
      });

      // Log activity
      repo.activity.append(project.id, "artifact-created", {
        event: "project-config-set",
        artifactId: briefArtifact.id,
        configWorkspace: config.workspace,
      });

      if (sessionId) {
        const session = repo.onboarding.getSession(sessionId);
        if (session && !session.completedAt) {
          repo.onboarding.completeSession(sessionId, project.id);
        }
      }

      res.status(201).json({ project, config: fullConfig, bootstrapArtifactId: briefArtifact.id });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}

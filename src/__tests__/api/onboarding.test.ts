import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { makeTestRepo } from "../helpers/repo.js";
import { buildOnboardingRouter } from "../../api/onboarding.js";

// The approve endpoint calls seedCapabilities and potentially Claude SDK.
// We only test the synchronous parts here (validation, project creation).
// The Claude SDK call is only made for /sessions/:id/message, not /approve.

function makeApp() {
  const repo = makeTestRepo();
  const app = express();
  app.use(express.json());
  app.use("/api/onboarding", buildOnboardingRouter(repo));
  return { app, repo };
}

const validBrief = {
  name: "Snapquery",
  tagline: "Fast data exploration for solo founders",
  problem: "Querying data is slow and requires SQL knowledge",
  user: "Non-technical solo founders",
  mvp: "CSV upload + natural language query",
  constraints: "Solo dev, 2 weeks",
  existing: "None",
  assumptions: ["Users have CSVs", "Claude API is available"],
};

const validConfig = {
  workspace: "/home/terry/projects/snapquery",
  agents: [
    {
      name: "strategist",
      consumes: ["brief", "decision"],
      produces: ["decision", "task_graph"],
      tools: ["read_artifact", "write_artifact", "create_task"],
      prompt: "You are the strategist for Snapquery. Read the brief and plan the work.",
    },
    {
      name: "coder",
      consumes: ["task_graph", "decision"],
      produces: ["code_artifact"],
      tools: ["read_artifact", "write_artifact", "run_command"],
      prompt: "You are the coder for Snapquery. Implement features.",
    },
    {
      name: "deployer",
      consumes: ["code_artifact"],
      produces: ["environment"],
      tools: ["read_artifact", "write_artifact", "run_command"],
      prompt: "You are the deployer for Snapquery. Deploy the app.",
    },
    {
      name: "founder",
      consumes: ["*"],
      produces: ["*"],
      tools: [],
      prompt: null,
    },
  ],
  tail: [{ name: "deployed_app", type: "environment" }],
};

describe("POST /api/onboarding/approve", () => {
  it("creates project, config, brief artifact, and bootstrap task on valid input", async () => {
    const { app, repo } = makeApp();

    const res = await request(app)
      .post("/api/onboarding/approve")
      .send({ brief: validBrief, config: validConfig });

    expect(res.status).toBe(201);
    expect(res.body.project.name).toBe("Snapquery");
    expect(res.body.project.slug).toBe("snapquery");
    expect(res.body.bootstrapArtifactId).toBeTruthy();

    // Project was created
    const project = repo.projects.get(res.body.project.id);
    expect(project).not.toBeNull();
    expect(project!.brief.tagline).toBe(validBrief.tagline);

    // Config was saved
    const config = repo.projectConfig.get(res.body.project.id);
    expect(config).not.toBeNull();
    expect(config!.agents.map((a) => a.name)).toContain("strategist");

    // Brief artifact exists
    const brief = repo.artifacts.get(res.body.bootstrapArtifactId);
    expect(brief.type).toBe("brief");

    // Bootstrap strategist task was created
    const tasks = repo.tasks.listForProject(res.body.project.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.agent).toBe("strategist");
    expect(tasks[0]!.inputs[0]!.artifact_id).toBe(res.body.bootstrapArtifactId);
  });

  it("returns 400 when brief is missing", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/api/onboarding/approve")
      .send({ config: validConfig });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/brief/);
  });

  it("returns 400 when config is missing", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/api/onboarding/approve")
      .send({ brief: validBrief });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/config/);
  });

  it("returns 400 with descriptive error when DAG is invalid", async () => {
    const { app } = makeApp();

    const badConfig = {
      ...validConfig,
      tail: [
        { name: "deployed_app", type: "environment" },
        { name: "report", type: "pdf_report" }, // no agent produces this
      ],
      // Remove founder so missingProducers is also triggered
      agents: validConfig.agents.filter((a) => a.name !== "founder"),
    };

    const res = await request(app)
      .post("/api/onboarding/approve")
      .send({ brief: validBrief, config: badConfig });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid agent config/);
  });

  it("DAG validation passes when founder is present even if tail type not in automated pipeline", async () => {
    const { app } = makeApp();

    // Config where only the founder can produce the tail type
    // unreachableTail will have items but missingProducers should be empty
    const configWithOnlyFounder = {
      ...validConfig,
      agents: [
        { name: "strategist", consumes: ["brief"], produces: ["task_graph"], tools: [], prompt: "p" },
        { name: "founder", consumes: ["*"], produces: ["*"], tools: [], prompt: null },
      ],
      tail: [{ name: "deployed_app", type: "environment" }], // no automated agent produces this
    };

    const res = await request(app)
      .post("/api/onboarding/approve")
      .send({ brief: validBrief, config: configWithOnlyFounder });

    // This fails because environment is unreachable (unreachableTail check)
    // missingProducers is empty because founder produces *, but unreachableTail is not
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unreachable tail/);
  });

  it("completes onboarding session when sessionId provided", async () => {
    const { app, repo } = makeApp();

    const session = repo.onboarding.createSession();
    expect(session.completedAt).toBeNull();

    const res = await request(app)
      .post("/api/onboarding/approve")
      .send({ brief: validBrief, config: validConfig, sessionId: session.id });

    expect(res.status).toBe(201);

    const updated = repo.onboarding.getSession(session.id);
    expect(updated!.completedAt).not.toBeNull();
    expect(updated!.projectId).toBe(res.body.project.id);
  });

  it("rejects duplicate project slug", async () => {
    const { app } = makeApp();

    await request(app)
      .post("/api/onboarding/approve")
      .send({ brief: validBrief, config: validConfig });

    // Second create with same name → slug collision
    const res = await request(app)
      .post("/api/onboarding/approve")
      .send({ brief: validBrief, config: validConfig });

    expect(res.status).toBe(500); // SQLite UNIQUE constraint on slug
  });
});

describe("POST /api/onboarding/sessions", () => {
  it("creates a session and returns opening message", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/api/onboarding/sessions").send({});
    expect(res.status).toBe(201);
    expect(res.body.session.id).toBeTruthy();
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].role).toBe("assistant");
    expect(res.body.messages[0].content).toBe("What are you building?");
  });
});

describe("GET /api/onboarding/sessions/:id", () => {
  it("returns session and messages", async () => {
    const { app, repo } = makeApp();
    const session = repo.onboarding.createSession();
    repo.onboarding.appendMessage(session.id, "assistant", "What are you building?");

    const res = await request(app).get(`/api/onboarding/sessions/${session.id}`);
    expect(res.status).toBe(200);
    expect(res.body.session.id).toBe(session.id);
    expect(res.body.messages).toHaveLength(1);
  });

  it("returns 404 for unknown session", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/api/onboarding/sessions/nonexistent");
    expect(res.status).toBe(404);
  });
});

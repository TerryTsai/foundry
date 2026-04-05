import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { makeTestRepo, makeTestProject } from "../helpers/repo.js";
import { buildTasksRouter } from "../../api/tasks.js";

function makeApp() {
  const repo = makeTestRepo();
  const app = express();
  app.use(express.json());
  app.use("/api/tasks", buildTasksRouter(repo));
  return { app, repo };
}

describe("GET /api/tasks", () => {
  it("lists tasks for a project", async () => {
    const { app, repo } = makeApp();
    const project = makeTestProject(repo);

    repo.tasks.create({
      projectId: project.id,
      agent: "strategist",
      description: "Plan",
      createdBy: "system",
      inputs: [],
      outputs: [{ name: "task_graph", type: "task_graph" }],
    });

    const res = await request(app).get(`/api/tasks?projectId=${project.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].agent).toBe("strategist");
    expect(res.body[0].state).toBe("pending");
  });

  it("filters tasks by agent", async () => {
    const { app, repo } = makeApp();
    const project = makeTestProject(repo);

    repo.tasks.create({ projectId: project.id, agent: "strategist", description: "A", createdBy: "system", inputs: [], outputs: [] });
    repo.tasks.create({ projectId: project.id, agent: "coder", description: "B", createdBy: "system", inputs: [], outputs: [] });

    const res = await request(app).get(`/api/tasks?projectId=${project.id}&agent=coder`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].agent).toBe("coder");
  });

  it("filters tasks by state", async () => {
    const { app, repo } = makeApp();
    const project = makeTestProject(repo);

    const t = repo.tasks.create({ projectId: project.id, agent: "strategist", description: "A", createdBy: "system", inputs: [], outputs: [{ name: "out", type: "x" }] });
    repo.artifacts.store({ projectId: project.id, type: "x", name: "out", content: "done", createdBy: "agent", taskId: t.id, outputName: "out" });

    const pending = await request(app).get(`/api/tasks?projectId=${project.id}&state=pending`);
    expect(pending.body).toHaveLength(0);

    const complete = await request(app).get(`/api/tasks?projectId=${project.id}&state=complete`);
    expect(complete.body).toHaveLength(1);
  });

  it("returns 400 when projectId missing", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/api/tasks");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/tasks/:id", () => {
  it("returns task with derived state", async () => {
    const { app, repo } = makeApp();
    const project = makeTestProject(repo);

    const task = repo.tasks.create({ projectId: project.id, agent: "strategist", description: "Test", createdBy: "system", inputs: [], outputs: [{ name: "out", type: "x" }] });

    const res = await request(app).get(`/api/tasks/${task.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(task.id);
    expect(res.body.state).toBe("pending");
  });

  it("returns 404 for unknown task", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/api/tasks/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/tasks/:id/complete", () => {
  it("writes output artifact for founder task", async () => {
    const { app, repo } = makeApp();
    const project = makeTestProject(repo);

    const task = repo.tasks.create({
      projectId: project.id,
      agent: "founder",
      description: "Decide on architecture",
      createdBy: "system",
      inputs: [],
      outputs: [{ name: "decision", type: "decision" }],
    });

    const res = await request(app)
      .post(`/api/tasks/${task.id}/complete`)
      .send({
        outputName: "decision",
        content: "Use PostgreSQL",
        type: "decision",
      });

    expect(res.status).toBe(201);
    expect(res.body.artifact_id).toBeTruthy();

    // Task should now be complete
    const taskState = repo.tasks.deriveState(task, repo.artifacts);
    expect(taskState).toBe("complete");
  });

  it("returns 404 for unknown task", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/api/tasks/nonexistent/complete")
      .send({ outputName: "out", content: "x", type: "x" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when outputName not in task outputs", async () => {
    const { app, repo } = makeApp();
    const project = makeTestProject(repo);

    const task = repo.tasks.create({
      projectId: project.id,
      agent: "founder",
      description: "Task",
      createdBy: "system",
      inputs: [],
      outputs: [{ name: "decision", type: "decision" }],
    });

    const res = await request(app)
      .post(`/api/tasks/${task.id}/complete`)
      .send({ outputName: "wrong_name", content: "x", type: "decision" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when type does not match declared output type", async () => {
    const { app, repo } = makeApp();
    const project = makeTestProject(repo);

    const task = repo.tasks.create({
      projectId: project.id,
      agent: "founder",
      description: "Task",
      createdBy: "system",
      inputs: [],
      outputs: [{ name: "decision", type: "decision" }],
    });

    const res = await request(app)
      .post(`/api/tasks/${task.id}/complete`)
      .send({ outputName: "decision", content: "x", type: "wrong_type" });

    expect(res.status).toBe(400);
  });
});

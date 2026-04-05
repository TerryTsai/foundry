import { describe, it, expect } from "vitest";
import { makeTestRepo, makeTestProject } from "../helpers/repo.js";
import type { Task } from "../../repository/types.js";

const baseConfig = {
  workspace: "/tmp/test",
  head: [{ name: "brief", type: "brief", artifact_id: "a1" }],
  tail: [{ name: "done", type: "output" }],
  agents: [
    { name: "strategist", consumes: ["brief"], produces: ["output"], tools: [], prompt: null },
    { name: "founder", consumes: ["*"], produces: ["*"], tools: [], prompt: null },
  ],
};

describe("TaskStore", () => {
  it("create and get a task", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);
    const task = repo.tasks.create({
      projectId: project.id,
      agent: "strategist",
      description: "Plan the project",
      createdBy: "system",
      inputs: [{ name: "brief", artifact_id: "a1" }],
      outputs: [{ name: "output", type: "output" }],
    });
    expect(task.id).toBeTruthy();
    expect(task.agent).toBe("strategist");
    expect(task.claimedAt).toBeNull();

    const fetched = repo.tasks.get(task.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(task.id);
  });

  it("deriveState: pending when unclaimed and no outputs", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);
    const task = repo.tasks.create({
      projectId: project.id,
      agent: "strategist",
      description: "Test",
      createdBy: "system",
      inputs: [],
      outputs: [{ name: "result", type: "output" }],
    });
    const state = repo.tasks.deriveState(task, repo.artifacts);
    expect(state).toBe("pending");
  });

  it("deriveState: running when claimed but no outputs written", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);
    const task = repo.tasks.create({
      projectId: project.id,
      agent: "strategist",
      description: "Test",
      createdBy: "system",
      inputs: [],
      outputs: [{ name: "result", type: "output" }],
    });
    repo.tasks.claim(task.id);
    const claimed = repo.tasks.get(task.id)!;
    const state = repo.tasks.deriveState(claimed, repo.artifacts);
    expect(state).toBe("running");
  });

  it("deriveState: complete when success output written", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);
    const task = repo.tasks.create({
      projectId: project.id,
      agent: "strategist",
      description: "Test",
      createdBy: "system",
      inputs: [],
      outputs: [{ name: "result", type: "output" }],
    });
    // Write the output artifact
    repo.artifacts.store({
      projectId: project.id,
      type: "output",
      name: "result",
      content: "done",
      createdBy: "agent",
      taskId: task.id,
      outputName: "result",
    });
    const state = repo.tasks.deriveState(task, repo.artifacts);
    expect(state).toBe("complete");
  });

  it("deriveState: failed when failure output written", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);
    const task = repo.tasks.create({
      projectId: project.id,
      agent: "strategist",
      description: "Test",
      createdBy: "system",
      inputs: [],
      outputs: [
        { name: "result", type: "output" },
        { name: "error", type: "error", isFailure: true },
      ],
    });
    repo.artifacts.store({
      projectId: project.id,
      type: "error",
      name: "error",
      content: "something went wrong",
      createdBy: "agent",
      taskId: task.id,
      outputName: "error",
    });
    const state = repo.tasks.deriveState(task, repo.artifacts);
    expect(state).toBe("failed");
  });

  it("findRoutable: returns task with all inputs present", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);

    // Store the input artifact
    const artifact = repo.artifacts.store({
      projectId: project.id,
      type: "brief",
      name: "brief",
      content: JSON.stringify({ tagline: "test" }),
      createdBy: "system",
    });

    const task = repo.tasks.create({
      projectId: project.id,
      agent: "strategist",
      description: "Test",
      createdBy: "system",
      inputs: [{ name: "brief", artifact_id: artifact.id }],
      outputs: [{ name: "output", type: "output" }],
    });

    const routable = repo.tasks.findRoutable(project.id);
    expect(routable.map((t) => t.id)).toContain(task.id);
  });

  it("findRoutable: does NOT return task with missing inputs", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);

    repo.tasks.create({
      projectId: project.id,
      agent: "strategist",
      description: "Test",
      createdBy: "system",
      inputs: [{ name: "brief", artifact_id: "nonexistent-id" }],
      outputs: [{ name: "output", type: "output" }],
    });

    const routable = repo.tasks.findRoutable(project.id);
    expect(routable).toHaveLength(0);
  });

  it("findRoutable: does NOT return already-claimed task", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);

    const task = repo.tasks.create({
      projectId: project.id,
      agent: "strategist",
      description: "Test",
      createdBy: "system",
      inputs: [],
      outputs: [{ name: "output", type: "output" }],
    });

    repo.tasks.claim(task.id);
    const routable = repo.tasks.findRoutable(project.id);
    expect(routable).toHaveLength(0);
  });

  it("findRoutable: does NOT return task with existing output artifact", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);

    const task = repo.tasks.create({
      projectId: project.id,
      agent: "strategist",
      description: "Test",
      createdBy: "system",
      inputs: [],
      outputs: [{ name: "output", type: "output" }],
    });

    // Write the output — task is now complete
    repo.artifacts.store({
      projectId: project.id,
      type: "output",
      name: "output",
      content: "done",
      createdBy: "agent",
      taskId: task.id,
      outputName: "output",
    });

    const routable = repo.tasks.findRoutable(project.id);
    expect(routable).toHaveLength(0);
  });

  it("recoverStalledTasks resets claimed-but-no-output tasks", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);

    const task = repo.tasks.create({
      projectId: project.id,
      agent: "strategist",
      description: "Test",
      createdBy: "system",
      inputs: [],
      outputs: [{ name: "output", type: "output" }],
    });

    repo.tasks.claim(task.id);
    expect(repo.tasks.get(task.id)!.claimedAt).not.toBeNull();

    const count = repo.tasks.recoverStalledTasks();
    expect(count).toBe(1);
    expect(repo.tasks.get(task.id)!.claimedAt).toBeNull();
  });

  it("recoverStalledTasks does NOT reset completed tasks", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);

    const task = repo.tasks.create({
      projectId: project.id,
      agent: "strategist",
      description: "Test",
      createdBy: "system",
      inputs: [],
      outputs: [{ name: "output", type: "output" }],
    });

    repo.tasks.claim(task.id);
    repo.artifacts.store({
      projectId: project.id,
      type: "output",
      name: "output",
      content: "done",
      createdBy: "agent",
      taskId: task.id,
      outputName: "output",
    });

    const count = repo.tasks.recoverStalledTasks();
    expect(count).toBe(0);
  });

  it("listForProject filters by state", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);

    const t1 = repo.tasks.create({
      projectId: project.id,
      agent: "strategist",
      description: "Pending task",
      createdBy: "system",
      inputs: [],
      outputs: [{ name: "out", type: "output" }],
    });

    const t2 = repo.tasks.create({
      projectId: project.id,
      agent: "strategist",
      description: "Complete task",
      createdBy: "system",
      inputs: [],
      outputs: [{ name: "out", type: "output" }],
    });

    repo.artifacts.store({
      projectId: project.id,
      type: "output",
      name: "out",
      content: "done",
      createdBy: "agent",
      taskId: t2.id,
      outputName: "out",
    });

    const pending = repo.tasks.listForProject(project.id, { state: "pending" });
    expect(pending.map((t) => t.id)).toContain(t1.id);
    expect(pending.map((t) => t.id)).not.toContain(t2.id);

    const complete = repo.tasks.listForProject(project.id, { state: "complete" });
    expect(complete.map((t) => t.id)).toContain(t2.id);
    expect(complete.map((t) => t.id)).not.toContain(t1.id);
  });
});

import { describe, it, expect } from "vitest";
import { makeTestRepo, makeTestProject } from "../helpers/repo.js";

describe("ArtifactStore", () => {
  it("store and retrieve an artifact", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);

    const artifact = repo.artifacts.store({
      projectId: project.id,
      type: "brief",
      name: "brief",
      content: JSON.stringify({ tagline: "Hello" }),
      createdBy: "system",
    });

    expect(artifact.id).toBeTruthy();
    expect(artifact.type).toBe("brief");
    expect(artifact.contentSize).toBeGreaterThan(0);

    const retrieved = repo.artifacts.get(artifact.id);
    expect(retrieved.content.toString("utf8")).toContain("Hello");
  });

  it("idempotent write: same task+output returns same artifact", () => {
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

    const a1 = repo.artifacts.store({
      projectId: project.id,
      type: "output",
      name: "result",
      content: "first write",
      createdBy: "agent",
      taskId: task.id,
      outputName: "result",
    });

    const a2 = repo.artifacts.store({
      projectId: project.id,
      type: "output",
      name: "result",
      content: "second write — different content, same task+output",
      createdBy: "agent",
      taskId: task.id,
      outputName: "result",
    });

    // Must return same artifact id — idempotent
    expect(a2.id).toBe(a1.id);
    // Content should be from the first write
    const retrieved = repo.artifacts.get(a1.id);
    expect(retrieved.content.toString("utf8")).toBe("first write");
  });

  it("different tasks can have outputs with same name", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);

    const t1 = repo.tasks.create({ projectId: project.id, agent: "a", description: "t1", createdBy: "system", inputs: [], outputs: [{ name: "out", type: "x" }] });
    const t2 = repo.tasks.create({ projectId: project.id, agent: "a", description: "t2", createdBy: "system", inputs: [], outputs: [{ name: "out", type: "x" }] });

    const a1 = repo.artifacts.store({ projectId: project.id, type: "x", name: "out", content: "task1", createdBy: "agent", taskId: t1.id, outputName: "out" });
    const a2 = repo.artifacts.store({ projectId: project.id, type: "x", name: "out", content: "task2", createdBy: "agent", taskId: t2.id, outputName: "out" });

    expect(a1.id).not.toBe(a2.id);
  });

  it("getByTaskOutput returns correct artifact", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);
    const task = repo.tasks.create({ projectId: project.id, agent: "a", description: "t", createdBy: "system", inputs: [], outputs: [{ name: "out", type: "x" }] });

    const stored = repo.artifacts.store({ projectId: project.id, type: "x", name: "out", content: "hello", createdBy: "agent", taskId: task.id, outputName: "out" });

    const found = repo.artifacts.getByTaskOutput(task.id, "out");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(stored.id);
  });

  it("list filters by type", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);

    repo.artifacts.store({ projectId: project.id, type: "brief", name: "brief", content: "b", createdBy: "system" });
    repo.artifacts.store({ projectId: project.id, type: "task_graph", name: "plan", content: "p", createdBy: "agent" });

    const briefs = repo.artifacts.list(project.id, "brief");
    expect(briefs).toHaveLength(1);
    expect(briefs[0]!.type).toBe("brief");

    const all = repo.artifacts.list(project.id);
    expect(all).toHaveLength(2);
  });

  it("list filters by taskId", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);

    const task = repo.tasks.create({ projectId: project.id, agent: "a", description: "t", createdBy: "system", inputs: [], outputs: [{ name: "out", type: "x" }] });

    repo.artifacts.store({ projectId: project.id, type: "brief", name: "brief", content: "not-task", createdBy: "system" });
    repo.artifacts.store({ projectId: project.id, type: "x", name: "out", content: "task-output", createdBy: "agent", taskId: task.id, outputName: "out" });

    const taskArtifacts = repo.artifacts.list(project.id, undefined, task.id);
    expect(taskArtifacts).toHaveLength(1);
    expect(taskArtifacts[0]!.taskId).toBe(task.id);
  });

  it("multiple bootstrap artifacts (null taskId) are allowed", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);

    const a1 = repo.artifacts.store({ projectId: project.id, type: "brief", name: "brief1", content: "b1", createdBy: "system" });
    const a2 = repo.artifacts.store({ projectId: project.id, type: "brief", name: "brief2", content: "b2", createdBy: "system" });

    expect(a1.id).not.toBe(a2.id);
  });
});

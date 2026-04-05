import { describe, it, expect } from "vitest";
import { makeTestRepo, makeTestProject } from "../helpers/repo.js";
import type { ProjectConfig } from "../../repository/types.js";

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    workspace: "/tmp/test",
    head: [{ name: "brief", type: "brief", artifact_id: "artifact-1" }],
    tail: [{ name: "deployed_app", type: "environment" }],
    agents: [
      {
        name: "strategist",
        consumes: ["brief"],
        produces: ["task_graph"],
        tools: ["write_artifact", "create_task"],
        prompt: "You are the strategist.",
      },
      {
        name: "coder",
        consumes: ["task_graph"],
        produces: ["code_artifact"],
        tools: ["write_artifact", "run_command"],
        prompt: "You are the coder.",
      },
      {
        name: "deployer",
        consumes: ["code_artifact"],
        produces: ["environment"],
        tools: ["write_artifact", "run_command"],
        prompt: "You are the deployer.",
      },
      {
        name: "founder",
        consumes: ["*"],
        produces: ["*"],
        tools: [],
        prompt: null,
      },
    ],
    ...overrides,
  };
}

describe("ProjectConfigStore.validateDag", () => {
  it("valid linear pipeline reaches tail", () => {
    const repo = makeTestRepo();
    makeTestProject(repo);
    const result = repo.projectConfig.validateDag(makeConfig());
    expect(result.valid).toBe(true);
    expect(result.unreachableTail).toHaveLength(0);
    expect(result.orphanedAgents).toHaveLength(0);
    expect(result.missingProducers).toHaveLength(0);
  });

  it("tail type unreachable when no agent produces it", () => {
    const repo = makeTestRepo();
    const config = makeConfig({
      tail: [{ name: "deployed_app", type: "environment" }, { name: "report", type: "pdf_report" }],
    });
    // no agent produces pdf_report
    const result = repo.projectConfig.validateDag(config);
    expect(result.valid).toBe(false);
    expect(result.unreachableTail).toContain("report");
  });

  it("missingProducers is empty when founder (star-producer) is present", () => {
    const repo = makeTestRepo();
    // No agent produces "environment" except the founder with produces: ["*"]
    const config = makeConfig({
      agents: [
        { name: "strategist", consumes: ["brief"], produces: ["task_graph"], tools: [], prompt: null },
        { name: "founder", consumes: ["*"], produces: ["*"], tools: [], prompt: null },
      ],
      tail: [{ name: "deployed_app", type: "environment" }],
    });
    const result = repo.projectConfig.validateDag(config);
    // missingProducers is empty because founder produces *
    expect(result.missingProducers).toHaveLength(0);
    // BUT environment is still unreachable from automated pipeline (no non-founder produces it)
    expect(result.unreachableTail).toContain("deployed_app");
    expect(result.valid).toBe(false);
  });

  it("valid: DAG with star-producer and fully reachable tail", () => {
    const repo = makeTestRepo();
    const config = makeConfig(); // deployer produces environment, founder covers *
    const result = repo.projectConfig.validateDag(config);
    expect(result.valid).toBe(true);
  });

  it("orphaned agent: consumes type never reachable", () => {
    const repo = makeTestRepo();
    const config = makeConfig({
      agents: [
        ...makeConfig().agents,
        {
          name: "ghost",
          consumes: ["nonexistent_type"],
          produces: ["ghost_output"],
          tools: [],
          prompt: null,
        },
      ],
    });
    const result = repo.projectConfig.validateDag(config);
    expect(result.orphanedAgents).toContain("ghost");
    // Still valid if tail is reachable
    expect(result.valid).toBe(true);
  });

  it("agent with empty consumes fires at start", () => {
    const repo = makeTestRepo();
    const config = makeConfig({
      agents: [
        {
          name: "always-fires",
          consumes: [],
          produces: ["special_output"],
          tools: [],
          prompt: null,
        },
        ...makeConfig().agents,
      ],
      tail: [
        { name: "deployed_app", type: "environment" },
        { name: "special", type: "special_output" },
      ],
    });
    const result = repo.projectConfig.validateDag(config);
    expect(result.valid).toBe(true);
  });

  it("consumer needs ANY (not ALL) of its consumed types", () => {
    const repo = makeTestRepo();
    // coder consumes [brief, task_graph] — should fire if only brief is reachable
    const config = makeConfig({
      agents: [
        {
          name: "coder",
          consumes: ["brief", "task_graph"],
          produces: ["code_artifact"],
          tools: [],
          prompt: null,
        },
        {
          name: "deployer",
          consumes: ["code_artifact"],
          produces: ["environment"],
          tools: [],
          prompt: null,
        },
        { name: "founder", consumes: ["*"], produces: ["*"], tools: [], prompt: null },
      ],
    });
    const result = repo.projectConfig.validateDag(config);
    expect(result.valid).toBe(true);
    expect(result.unreachableTail).toHaveLength(0);
  });

  it("set and get config round-trips correctly", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);
    const config = makeConfig();
    repo.projectConfig.set(project.id, config, "founder");
    const retrieved = repo.projectConfig.get(project.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.workspace).toBe(config.workspace);
    expect(retrieved!.agents).toHaveLength(config.agents.length);
    expect(retrieved!.tail).toHaveLength(config.tail.length);
  });

  it("listVersions returns all versions and get() returns latest", () => {
    const repo = makeTestRepo();
    const project = makeTestProject(repo);
    const v1 = makeConfig({ workspace: "/v1" });
    const v2 = makeConfig({ workspace: "/v2" });
    repo.projectConfig.set(project.id, v1, "founder");
    repo.projectConfig.set(project.id, v2, "founder");

    // listVersions returns both
    const versions = repo.projectConfig.listVersions(project.id);
    expect(versions).toHaveLength(2);
    const workspaces = versions.map((v) => v.workspace);
    expect(workspaces).toContain("/v1");
    expect(workspaces).toContain("/v2");

    // get() returns the latest-inserted (v2) — rowid DESC breaks timestamp ties
    const latest = repo.projectConfig.get(project.id);
    expect(latest).not.toBeNull();
    expect(latest!.workspace).toBe("/v2");
  });
});

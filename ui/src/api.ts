import type {
  Project,
  Decision,
  DecisionDomain,
  Escalation,
  ActivityEntry,
  ProjectCapability,
  Artifact,
  EngineRun,
  Task,
  ProjectConfig,
  DagValidationResult,
} from "./types";

async function extractError(res: Response): Promise<string> {
  try {
    const body = await res.clone().json() as { error?: string };
    if (body?.error) return body.error;
  } catch { /* fall through */ }
  return `${res.status} ${res.statusText}`;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(await extractError(res));
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json() as Promise<T>;
}

export const api = {
  projects: {
    list: () => get<Project[]>("/api/projects?status=active"),
    get: (id: string) => get<Project>(`/api/projects/${id}`),
  },

  decisions: {
    latest: (projectId: string, domain?: DecisionDomain) =>
      get<Decision[]>(
        `/api/decisions?projectId=${projectId}&view=latest${domain ? `&domain=${domain}` : ""}`
      ),
    log: (projectId: string, domain?: DecisionDomain) =>
      get<Decision[]>(
        `/api/decisions?projectId=${projectId}${domain ? `&domain=${domain}` : ""}`
      ),
  },

  escalations: {
    list: (projectId: string) =>
      get<Escalation[]>(`/api/escalations?projectId=${projectId}`),
    resolve: (id: string, body: { resolvedBy: "ceo" | "timeout"; resolution?: string }) =>
      post<{ success: boolean }>(`/api/escalations/${id}/resolve`, body),
  },

  activity: {
    list: (projectId: string, limit = 100) =>
      get<ActivityEntry[]>(`/api/activity?projectId=${projectId}&limit=${limit}`),
  },

  capabilities: {
    forProject: (projectId: string) =>
      get<ProjectCapability[]>(`/api/capabilities/project?projectId=${projectId}`),
    get: (id: string) => get<ProjectCapability>(`/api/capabilities/project/${id}`),
    saveCredentials: (id: string, credentials: Record<string, string>) =>
      post<{ success: boolean }>(`/api/capabilities/project/${id}/credentials`, credentials),
    test: (id: string) =>
      post<{ success: boolean; output: string | null; error: string | null }>(
        `/api/capabilities/project/${id}/test`,
        {}
      ),
    definitions: () => get<import("./types").CapabilityDefinition[]>("/api/capabilities/definitions"),
    addToProject: (projectId: string, capabilityId: string) =>
      post<ProjectCapability>("/api/capabilities/project", { projectId, capabilityId }),
  },

  artifacts: {
    list: (projectId: string, type?: string, taskId?: string) => {
      const params = new URLSearchParams({ projectId });
      if (type) params.set("type", type);
      if (taskId) params.set("taskId", taskId);
      return get<Artifact[]>(`/api/artifacts?${params}`);
    },
    get: (id: string) => get<Artifact>(`/api/artifacts/${id}`),
    content: (id: string) =>
      fetch(`/api/artifacts/${id}/download`).then((r) =>
        r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))
      ),
    snapshot: (projectId: string, repoPath: string) =>
      post<Artifact>("/api/artifacts/snapshot", { projectId, repoPath }),
  },

  tasks: {
    list: (projectId: string, agent?: string, state?: string) => {
      const params = new URLSearchParams({ projectId });
      if (agent) params.set("agent", agent);
      if (state) params.set("state", state);
      return get<Task[]>(`/api/tasks?${params}`);
    },
    get: (id: string) => get<Task>(`/api/tasks/${id}`),
    complete: (
      id: string,
      body: { outputName: string; content: string; type: string; metadata?: Record<string, unknown> }
    ) => post<{ artifact_id: string }>(`/api/tasks/${id}/complete`, body),
  },

  config: {
    get: (projectId: string) => get<ProjectConfig>(`/api/projects/${projectId}/config`),
    update: (projectId: string, config: ProjectConfig) =>
      put<ProjectConfig>(`/api/projects/${projectId}/config`, config),
  },

  admin: {
    runNow: (projectId: string) =>
      post<{ queued: boolean }>(`/api/admin/run/${projectId}`, {}),
    getRuns: (projectId: string) =>
      get<{ current: EngineRun | null; last: EngineRun | null }>(`/api/admin/runs/${projectId}`),
    validateDag: (projectId: string) =>
      get<DagValidationResult>(`/api/admin/dag/${projectId}`),
  },

  onboarding: {
    createSession: () =>
      post<{ session: { id: string }; messages: OnboardingMessage[] }>("/api/onboarding/sessions", {}),
    getSession: (id: string) =>
      get<{ session: { id: string; completedAt: string | null; projectId: string | null }; messages: OnboardingMessage[] }>(`/api/onboarding/sessions/${id}`),
    sendMessage: (sessionId: string, content: string) =>
      post<{ message: OnboardingMessage }>(`/api/onboarding/sessions/${sessionId}/message`, { content }),
    approve: (sessionId: string, brief: OnboardingBrief, config: OnboardingConfig) =>
      post<Project>("/api/onboarding/approve", { sessionId, brief, config }),
  },
};

export interface OnboardingMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface OnboardingBrief {
  name: string;
  tagline: string;
  problem: string;
  user: string;
  mvp: string;
  constraints: string;
  existing: string;
  assumptions: string[];
}

export interface OnboardingConfig {
  workspace: string;
  agents: import("./types").AgentDefinition[];
  tail: Array<{ name: string; type: string }>;
}

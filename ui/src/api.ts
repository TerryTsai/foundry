import type {
  Project,
  Decision,
  DecisionDomain,
  Escalation,
  ActivityEntry,
  ProjectCapability,
  Artifact,
  EngineRun,
} from "./types";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
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
    list: (projectId: string) =>
      get<Artifact[]>(`/api/artifacts?projectId=${projectId}`),
    snapshot: (projectId: string, repoPath: string) =>
      post<Artifact>("/api/artifacts/snapshot", { projectId, repoPath }),
  },

  admin: {
    runNow: (projectId: string) =>
      post<{ queued: boolean }>(`/api/admin/run/${projectId}`, {}),
    getRuns: (projectId: string) =>
      get<{ current: EngineRun | null; last: EngineRun | null }>(`/api/admin/runs/${projectId}`),
  },

  onboarding: {
    createSession: () =>
      post<{ session: { id: string }; messages: OnboardingMessage[] }>("/api/onboarding/sessions", {}),
    getSession: (id: string) =>
      get<{ session: { id: string; completedAt: string | null; projectId: string | null }; messages: OnboardingMessage[] }>(`/api/onboarding/sessions/${id}`),
    sendMessage: (sessionId: string, content: string) =>
      post<{ message: OnboardingMessage }>(`/api/onboarding/sessions/${sessionId}/message`, { content }),
    approve: (sessionId: string, brief: OnboardingBrief) =>
      post<Project>("/api/onboarding/approve", { sessionId, brief }),
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

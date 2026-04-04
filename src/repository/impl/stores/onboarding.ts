import { eq, desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { onboardingSessions, onboardingMessages } from "../schema/index.js";
import type * as schema from "../schema/index.js";

type DB = BetterSQLite3Database<typeof schema>;

export interface OnboardingSession {
  id: string;
  createdAt: string;
  completedAt: string | null;
  projectId: string | null;
}

export interface OnboardingMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export class OnboardingStore {
  constructor(private readonly db: DB) {}

  createSession(): OnboardingSession {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.insert(onboardingSessions).values({ id, createdAt }).run();
    return { id, createdAt, completedAt: null, projectId: null };
  }

  getSession(id: string): OnboardingSession | null {
    const row = this.db
      .select()
      .from(onboardingSessions)
      .where(eq(onboardingSessions.id, id))
      .get();
    if (!row) return null;
    return {
      id: row.id,
      createdAt: row.createdAt,
      completedAt: row.completedAt ?? null,
      projectId: row.projectId ?? null,
    };
  }

  completeSession(id: string, projectId: string): void {
    this.db
      .update(onboardingSessions)
      .set({ completedAt: new Date().toISOString(), projectId })
      .where(eq(onboardingSessions.id, id))
      .run();
  }

  appendMessage(sessionId: string, role: "user" | "assistant", content: string): OnboardingMessage {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    this.db.insert(onboardingMessages).values({ id, sessionId, role, content, timestamp }).run();
    return { id, sessionId, role, content, timestamp };
  }

  getMessages(sessionId: string): OnboardingMessage[] {
    const rows = this.db
      .select()
      .from(onboardingMessages)
      .where(eq(onboardingMessages.sessionId, sessionId))
      .orderBy(onboardingMessages.timestamp)
      .all();
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      role: r.role as "user" | "assistant",
      content: r.content,
      timestamp: r.timestamp,
    }));
  }

  listActive(): OnboardingSession[] {
    const rows = this.db
      .select()
      .from(onboardingSessions)
      .where(eq(onboardingSessions.completedAt, null as unknown as string))
      .orderBy(desc(onboardingSessions.createdAt))
      .all();
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      completedAt: null,
      projectId: null,
    }));
  }
}

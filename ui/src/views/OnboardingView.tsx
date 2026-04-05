import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type OnboardingMessage, type OnboardingBrief, type OnboardingConfig } from "../api";

// ── Brief XML parser ──────────────────────────────────────────────

function parseBrief(text: string): OnboardingBrief | null {
  const match = text.match(/<brief>([\s\S]*?)<\/brief>/);
  if (!match) return null;
  const xml = match[1]!;

  function tag(name: string): string {
    const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`));
    return m ? m[1]!.trim() : "";
  }

  const assumptionsRaw = xml.match(/<assumption>([\s\S]*?)<\/assumption>/g) ?? [];
  const assumptions = assumptionsRaw.map((a) =>
    a.replace(/<\/?assumption>/g, "").trim()
  );

  return {
    name: tag("n"),
    tagline: tag("tagline"),
    problem: tag("problem"),
    user: tag("user"),
    mvp: tag("mvp"),
    constraints: tag("constraints"),
    existing: tag("existing"),
    assumptions,
  };
}

function stripBrief(text: string): string {
  return text
    .replace(/<brief>[\s\S]*?<\/brief>/, "")
    .replace(/<config>[\s\S]*?<\/config>/, "")
    .trim();
}

function parseConfig(text: string): OnboardingConfig | null {
  const match = text.match(/<config>([\s\S]*?)<\/config>/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]!.trim()) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "workspace" in parsed &&
      "agents" in parsed &&
      "tail" in parsed
    ) {
      return parsed as OnboardingConfig;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Message bubble ────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: OnboardingMessage }) {
  const isUser = msg.role === "user";
  const brief = !isUser ? parseBrief(msg.content) : null;
  const displayText = brief ? stripBrief(msg.content) : msg.content;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm font-mono leading-relaxed ${
          isUser
            ? "bg-accent-blue text-white rounded-br-sm"
            : "bg-surface-2 text-text-primary rounded-bl-sm"
        }`}
      >
        {displayText && <p className="whitespace-pre-wrap">{displayText}</p>}
        {brief && <BriefCard brief={brief} />}
      </div>
    </div>
  );
}

// ── Brief preview card ────────────────────────────────────────────

function BriefCard({
  brief,
  onApprove,
}: {
  brief: OnboardingBrief;
  onApprove?: () => void;
}) {
  return (
    <div className="mt-3 border border-border rounded-xl overflow-hidden text-xs">
      <div className="bg-surface-3 px-3 py-2 font-syne font-semibold text-text-primary text-sm">
        {brief.name || "Project Brief"}
      </div>
      <div className="px-3 py-2 space-y-2 text-text-secondary">
        {brief.tagline && (
          <p className="italic text-text-dim">{brief.tagline}</p>
        )}
        {brief.problem && (
          <div>
            <span className="text-text-dim uppercase tracking-wide text-[10px]">Problem</span>
            <p className="mt-0.5">{brief.problem}</p>
          </div>
        )}
        {brief.user && (
          <div>
            <span className="text-text-dim uppercase tracking-wide text-[10px]">User</span>
            <p className="mt-0.5">{brief.user}</p>
          </div>
        )}
        {brief.mvp && (
          <div>
            <span className="text-text-dim uppercase tracking-wide text-[10px]">MVP</span>
            <p className="mt-0.5">{brief.mvp}</p>
          </div>
        )}
        {brief.constraints && (
          <div>
            <span className="text-text-dim uppercase tracking-wide text-[10px]">Constraints</span>
            <p className="mt-0.5">{brief.constraints}</p>
          </div>
        )}
        {brief.assumptions.length > 0 && (
          <div>
            <span className="text-text-dim uppercase tracking-wide text-[10px]">Assumptions</span>
            <ul className="mt-0.5 space-y-0.5">
              {brief.assumptions.map((a, i) => (
                <li key={i} className="flex gap-1">
                  <span className="text-text-dim">·</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {onApprove && (
        <div className="px-3 py-2 border-t border-border">
          <button
            onClick={onApprove}
            className="w-full bg-accent-blue hover:bg-accent-blue/90 text-white text-xs font-syne font-semibold rounded-lg py-2 transition-colors"
          >
            Approve & Create Project
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Onboarding view ──────────────────────────────────────────

export function OnboardingView() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<OnboardingMessage[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(sessionId ?? null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionComplete, setSessionComplete] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load or create session
  useEffect(() => {
    if (sessionId) {
      api.onboarding.getSession(sessionId).then(({ session, messages: msgs }) => {
        setMessages(msgs);
        setCurrentSessionId(session.id);
        if (session.completedAt) {
          setSessionComplete(true);
          if (session.projectId) {
            navigate(`/${session.projectId}/world`, { replace: true });
          }
        }
      }).catch((e) => setError(String(e)));
    } else {
      api.onboarding.createSession().then(({ session, messages: msgs }) => {
        setMessages(msgs);
        setCurrentSessionId(session.id);
        navigate(`/new/${session.id}`, { replace: true });
      }).catch((e) => setError(String(e)));
    }
  }, [sessionId, navigate]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Find latest brief + config in assistant messages
  const latestBrief = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && parseBrief(m.content) !== null);
  const pendingBrief = latestBrief ? parseBrief(latestBrief.content) : null;
  const pendingConfig = latestBrief ? parseConfig(latestBrief.content) : null;

  async function sendMessage() {
    const text = input.trim();
    if (!text || !currentSessionId || sending) return;

    setInput("");
    setSending(true);
    setError(null);

    // Optimistic user message
    const optimistic: OnboardingMessage = {
      id: `opt-${Date.now()}`,
      sessionId: currentSessionId,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const { message } = await api.onboarding.sendMessage(currentSessionId, text);
      // Replace optimistic + add reply
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimistic.id),
        { ...optimistic, id: `user-${Date.now()}` },
        message,
      ]);
    } catch (e) {
      setError(String(e));
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(text);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function approveBrief() {
    if (!pendingBrief || !pendingConfig || !currentSessionId || approving) return;
    setApproving(true);
    setError(null);
    try {
      const project = await api.onboarding.approve(currentSessionId, pendingBrief, pendingConfig);
      navigate(`/${project.id}/dag`, { replace: true });
    } catch (e) {
      setError(String(e));
      setApproving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  if (error && messages.length === 0) {
    return (
      <div className="h-dvh flex items-center justify-center bg-surface-0 px-6">
        <div className="text-center">
          <p className="font-mono text-sm text-red-400 mb-4">{error}</p>
          <button
            onClick={() => navigate("/")}
            className="font-mono text-xs text-text-dim hover:text-text-primary underline"
          >
            Back to projects
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-surface-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-1 shrink-0">
        <button
          onClick={() => navigate("/")}
          className="font-mono text-xs text-text-dim hover:text-text-primary transition-colors"
        >
          ← Back
        </button>
        <span className="font-syne font-bold text-text-primary text-sm">New Project</span>
        <div className="w-10" />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.map((msg) => {
          const brief = msg.role === "assistant" ? parseBrief(msg.content) : null;
          const isLatestWithBrief = latestBrief?.id === msg.id;
          return (
            <div key={msg.id}>
              <MessageBubble msg={msg} />
              {brief && isLatestWithBrief && !sessionComplete && (
                <div className="flex justify-start mb-3">
                  <div className="max-w-[80%] space-y-1.5">
                    {!pendingConfig && (
                      <p className="text-[10px] font-mono text-accent-amber px-1">
                        Waiting for agent config… ask "suggest an agent config" if it hasn't appeared.
                      </p>
                    )}
                    <button
                      onClick={approveBrief}
                      disabled={approving || !pendingConfig}
                      className="w-full bg-accent-blue hover:bg-accent-blue/90 disabled:opacity-40 text-white text-xs font-syne font-semibold rounded-xl py-2.5 px-4 transition-colors"
                    >
                      {approving ? "Creating project…" : "Approve & Create Project"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {sending && (
          <div className="flex justify-start mb-3">
            <div className="bg-surface-2 rounded-2xl rounded-bl-sm px-4 py-3">
              <span className="font-mono text-text-dim text-sm animate-pulse">…</span>
            </div>
          </div>
        )}
        {error && (
          <p className="font-mono text-xs text-red-400 text-center mb-2">{error}</p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {!sessionComplete && (
        <div className="shrink-0 px-4 py-3 border-t border-border bg-surface-1">
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending || approving || !currentSessionId}
              placeholder="Reply…"
              rows={1}
              className="flex-1 resize-none bg-surface-2 border border-border rounded-xl px-3 py-2.5 font-mono text-sm text-text-primary placeholder-text-dim focus:outline-none focus:border-accent-blue disabled:opacity-50 leading-relaxed"
              style={{ maxHeight: "120px", overflowY: "auto" }}
            />
            <button
              onClick={() => void sendMessage()}
              disabled={!input.trim() || sending || approving || !currentSessionId}
              className="shrink-0 bg-accent-blue hover:bg-accent-blue/90 disabled:opacity-40 text-white rounded-xl px-4 py-2.5 font-syne font-semibold text-sm transition-colors"
            >
              Send
            </button>
          </div>
          <p className="font-mono text-[10px] text-text-dim mt-1.5 text-center">
            Enter to send · Shift+Enter for newline
          </p>
        </div>
      )}
    </div>
  );
}

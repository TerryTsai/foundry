import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import type { ProjectConfig, AgentDefinition, ProjectConfigTail, DagValidationResult } from "../types";

const AVAILABLE_TOOLS = [
  "bash",
  "http",
  "playwright",
  "read_file",
  "write_file",
  "search",
  "git",
  "database",
  "email",
  "slack",
];

function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  function addTag() {
    const tag = input.trim();
    if (!tag || values.includes(tag)) return;
    onChange([...values, tag]);
    setInput("");
  }

  function removeTag(v: string) {
    onChange(values.filter((t) => t !== v));
  }

  return (
    <div className="flex flex-wrap gap-1.5 p-2 bg-surface-3 border border-border rounded-xl min-h-[44px]">
      {values.map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/10 text-text-secondary text-xs font-mono"
        >
          {v}
          <button
            onClick={() => removeTag(v)}
            className="text-text-dim hover:text-text-primary ml-0.5"
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag();
          }
        }}
        onBlur={addTag}
        placeholder={placeholder}
        className="flex-1 min-w-[80px] bg-transparent text-xs font-mono text-text-primary placeholder-text-dim focus:outline-none"
      />
    </div>
  );
}

interface AgentEditorProps {
  agent: AgentDefinition;
  index: number;
  onChange: (updated: AgentDefinition) => void;
  onRemove: () => void;
  dagErrors?: DagValidationResult | null;
}

function AgentEditor({ agent, index, onChange, onRemove, dagErrors }: AgentEditorProps) {
  const [collapsed, setCollapsed] = useState(index > 0);
  const isOrphaned = dagErrors?.orphanedAgents.includes(agent.name);

  return (
    <div
      className={`bg-surface-2 rounded-xl border overflow-hidden ${
        isOrphaned ? "border-accent-amber/40" : "border-border"
      }`}
    >
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between p-3 hover:bg-surface-3/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-text-primary">{agent.name || "(unnamed)"}</span>
          {isOrphaned && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-amber/15 text-accent-amber">
              orphaned
            </span>
          )}
        </div>
        <span className="text-text-dim text-xs font-mono">{collapsed ? "▾" : "▴"}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/50 pt-3">
          {/* Name */}
          <div>
            <label className="block text-xs font-mono text-text-dim mb-1">name</label>
            <input
              type="text"
              value={agent.name}
              onChange={(e) => onChange({ ...agent, name: e.target.value })}
              className="w-full bg-surface-3 border border-border rounded-xl px-3 py-2 text-sm font-mono text-text-primary placeholder-text-dim focus:outline-none focus:border-white/30 min-h-[44px]"
              placeholder="agent-name"
            />
          </div>

          {/* Consumes */}
          <div>
            <label className="block text-xs font-mono text-text-dim mb-1">consumes (artifact types)</label>
            <TagInput
              values={agent.consumes}
              onChange={(v) => onChange({ ...agent, consumes: v })}
              placeholder="type…"
            />
          </div>

          {/* Produces */}
          <div>
            <label className="block text-xs font-mono text-text-dim mb-1">produces (artifact types)</label>
            <TagInput
              values={agent.produces}
              onChange={(v) => onChange({ ...agent, produces: v })}
              placeholder="type…"
            />
          </div>

          {/* Tools */}
          <div>
            <label className="block text-xs font-mono text-text-dim mb-1.5">tools</label>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_TOOLS.map((tool) => {
                const checked = agent.tools.includes(tool);
                return (
                  <button
                    key={tool}
                    onClick={() => {
                      const next = checked
                        ? agent.tools.filter((t) => t !== tool)
                        : [...agent.tools, tool];
                      onChange({ ...agent, tools: next });
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-mono border transition-colors min-h-[36px] ${
                      checked
                        ? "bg-accent-blue/20 text-accent-blue border-accent-blue/40"
                        : "bg-white/5 text-text-dim border-border"
                    }`}
                  >
                    {tool}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-xs font-mono text-text-dim mb-1">prompt</label>
            <textarea
              value={agent.prompt ?? ""}
              onChange={(e) => onChange({ ...agent, prompt: e.target.value || null })}
              rows={4}
              className="w-full bg-surface-3 border border-border rounded-xl px-3 py-2.5 text-sm font-lora text-text-primary placeholder-text-dim focus:outline-none focus:border-white/30 resize-none"
              placeholder="System prompt for this agent…"
            />
          </div>

          <button
            onClick={onRemove}
            className="w-full py-2 rounded-xl border border-accent-red/30 text-accent-red text-xs font-mono hover:bg-accent-red/10 transition-colors min-h-[44px]"
          >
            Remove Agent
          </button>
        </div>
      )}
    </div>
  );
}

interface TailEditorProps {
  tail: ProjectConfigTail[];
  onChange: (tail: ProjectConfigTail[]) => void;
  dagErrors?: DagValidationResult | null;
}

function TailEditor({ tail, onChange, dagErrors }: TailEditorProps) {
  function addItem() {
    onChange([...tail, { name: "", type: "" }]);
  }

  function updateItem(i: number, partial: Partial<ProjectConfigTail>) {
    const next = tail.map((t, idx) => (idx === i ? { ...t, ...partial } : t));
    onChange(next);
  }

  function removeItem(i: number) {
    onChange(tail.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-2">
      {tail.map((item, i) => {
        const isUnreachable = dagErrors?.unreachableTail.includes(item.type);
        return (
          <div
            key={i}
            className={`flex items-center gap-2 p-2 rounded-xl bg-surface-3 border ${
              isUnreachable ? "border-accent-red/40" : "border-border"
            }`}
          >
            <input
              type="text"
              value={item.name}
              onChange={(e) => updateItem(i, { name: e.target.value })}
              className="flex-1 bg-transparent text-xs font-mono text-text-primary placeholder-text-dim focus:outline-none min-h-[36px]"
              placeholder="name"
            />
            <span className="text-text-dim text-xs font-mono">/</span>
            <input
              type="text"
              value={item.type}
              onChange={(e) => updateItem(i, { type: e.target.value })}
              className={`flex-1 bg-transparent text-xs font-mono placeholder-text-dim focus:outline-none min-h-[36px] ${
                isUnreachable ? "text-accent-red" : "text-text-primary"
              }`}
              placeholder="type"
            />
            {isUnreachable && (
              <span className="text-[10px] font-mono text-accent-red flex-shrink-0">unreachable</span>
            )}
            <button
              onClick={() => removeItem(i)}
              className="text-text-dim hover:text-accent-red transition-colors text-sm flex-shrink-0 p-1 min-h-[36px] min-w-[36px] flex items-center justify-center"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        onClick={addItem}
        className="w-full py-2 rounded-xl border border-border text-text-dim text-xs font-mono hover:bg-surface-3 transition-colors min-h-[44px]"
      >
        + Add Tail Output
      </button>
    </div>
  );
}

export function ConfigView() {
  const { projectId } = useParams<{ projectId: string }>();
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dagResult, setDagResult] = useState<DagValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!projectId) return;
    api.config
      .get(projectId)
      .then((c) => {
        setConfig(c);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId]);

  function handleChange(updated: ProjectConfig) {
    setConfig(updated);
    setSaveResult(null);

    // Debounced DAG validation — validate against current projectId
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!projectId) return;
      setValidating(true);
      api.admin
        .validateDag(projectId)
        .then((r) => {
          setDagResult(r);
          setValidating(false);
        })
        .catch(() => setValidating(false));
    }, 500);
  }

  async function handleSave() {
    if (!config || !projectId) return;
    setSaving(true);
    setSaveResult(null);
    setSaveError(null);
    try {
      await api.config.update(projectId, config);
      setSaveResult("success");
      // Refresh DAG validation after save
      const r = await api.admin.validateDag(projectId);
      setDagResult(r);
    } catch (err) {
      setSaveResult("error");
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }

  function addAgent() {
    if (!config) return;
    handleChange({
      ...config,
      agents: [
        ...config.agents,
        { name: "", consumes: [], produces: [], tools: [], prompt: null },
      ],
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-dim font-mono text-sm">
        loading…
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-full text-accent-red font-mono text-sm">
        config not found
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        <div>
          <p className="text-xs font-mono text-text-dim uppercase tracking-wider mb-3">Project Config</p>

          {/* DAG validation result */}
          {dagResult && (
            <div
              className={`rounded-xl p-3 border mb-4 ${
                dagResult.valid
                  ? "bg-accent-green/10 border-accent-green/30"
                  : "bg-accent-red/10 border-accent-red/30"
              }`}
            >
              <p
                className={`text-xs font-mono mb-1 ${
                  dagResult.valid ? "text-accent-green" : "text-accent-red"
                }`}
              >
                {validating ? "validating…" : dagResult.valid ? "✓ DAG valid" : "✗ DAG errors"}
              </p>
              {!dagResult.valid && (
                <div className="space-y-0.5 text-xs font-mono">
                  {dagResult.unreachableTail.length > 0 && (
                    <p className="text-accent-red">
                      unreachable tail: {dagResult.unreachableTail.join(", ")}
                    </p>
                  )}
                  {dagResult.orphanedAgents.length > 0 && (
                    <p className="text-accent-amber">
                      orphaned agents: {dagResult.orphanedAgents.join(", ")}
                    </p>
                  )}
                  {dagResult.missingProducers.length > 0 && (
                    <p className="text-accent-red">
                      missing producers: {dagResult.missingProducers.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Workspace */}
        <section>
          <p className="text-xs font-mono text-text-dim mb-2">workspace</p>
          <input
            type="text"
            value={config.workspace}
            onChange={(e) => handleChange({ ...config, workspace: e.target.value })}
            className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-text-primary placeholder-text-dim focus:outline-none focus:border-white/30 min-h-[44px]"
            placeholder="/path/to/workspace"
          />
        </section>

        {/* Agents */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-mono text-text-dim">agents ({config.agents.length})</p>
            <button
              onClick={addAgent}
              className="text-xs font-mono text-accent-blue px-3 py-1.5 rounded-lg border border-accent-blue/30 bg-accent-blue/10 hover:bg-accent-blue/20 transition-colors min-h-[36px]"
            >
              + Add Agent
            </button>
          </div>
          <div className="space-y-2">
            {config.agents.map((agent, i) => (
              <AgentEditor
                key={i}
                agent={agent}
                index={i}
                onChange={(updated) => {
                  const agents = config.agents.map((a, idx) => (idx === i ? updated : a));
                  handleChange({ ...config, agents });
                }}
                onRemove={() => {
                  handleChange({
                    ...config,
                    agents: config.agents.filter((_, idx) => idx !== i),
                  });
                }}
                dagErrors={dagResult}
              />
            ))}
            {config.agents.length === 0 && (
              <p className="text-xs font-mono text-text-dim py-2">no agents configured</p>
            )}
          </div>
        </section>

        {/* Tail */}
        <section>
          <p className="text-xs font-mono text-text-dim mb-2">tail outputs</p>
          <TailEditor
            tail={config.tail}
            onChange={(tail) => handleChange({ ...config, tail })}
            dagErrors={dagResult}
          />
        </section>
      </div>

      {/* Save button */}
      <div className="flex-shrink-0 px-4 pb-8 pt-3 border-t border-border bg-surface-1 space-y-2">
        {saveResult === "success" && (
          <p className="text-xs font-mono text-accent-green text-center">✓ saved successfully</p>
        )}
        {saveResult === "error" && saveError && (
          <p className="text-xs font-mono text-accent-red text-center">{saveError}</p>
        )}
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="w-full py-3.5 rounded-xl bg-accent-blue/20 text-accent-blue border border-accent-blue/30 font-syne font-medium text-sm hover:bg-accent-blue/30 transition-colors disabled:opacity-40 min-h-[48px]"
        >
          {saving ? "Saving…" : "Save Config"}
        </button>
      </div>
    </div>
  );
}

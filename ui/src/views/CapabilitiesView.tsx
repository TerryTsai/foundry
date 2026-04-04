import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import type { ProjectCapability, CapabilityDefinition } from "../types";

const STATUS_ORDER = ["active", "configured", "error", "pending", "revoked"] as const;

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  configured: "Configured",
  pending: "Pending Setup",
  error: "Error",
  revoked: "Revoked",
};

const STATUS_COLOR: Record<string, string> = {
  active: "text-green-400",
  configured: "text-blue-400",
  pending: "text-amber-400",
  error: "text-red-400",
  revoked: "text-text-dim",
};

const STATUS_DOT: Record<string, string> = {
  active: "bg-green-400",
  configured: "bg-blue-400",
  pending: "bg-amber-400",
  error: "bg-red-400",
  revoked: "bg-white/20",
};

export function CapabilitiesView() {
  const { projectId } = useParams<{ projectId: string }>();
  const [capabilities, setCapabilities] = useState<ProjectCapability[]>([]);
  const [allDefs, setAllDefs] = useState<CapabilityDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ProjectCapability | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const reload = useCallback(() => {
    if (!projectId) return;
    Promise.all([
      api.capabilities.forProject(projectId),
      api.capabilities.definitions(),
    ]).then(([caps, defs]) => {
      setCapabilities(caps);
      setAllDefs(defs);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  const projectCapabilityIds = new Set(capabilities.map((c) => c.capabilityId));
  const available = allDefs.filter((d) => !projectCapabilityIds.has(d.id));

  const grouped = STATUS_ORDER.reduce<Record<string, ProjectCapability[]>>((acc, s) => {
    const items = capabilities.filter((c) => c.status === s);
    if (items.length > 0) acc[s] = items;
    return acc;
  }, {});

  if (selected) {
    return (
      <ConfigureView
        pc={selected}
        onBack={() => { setSelected(null); reload(); }}
      />
    );
  }

  if (showAdd) {
    return (
      <AddView
        projectId={projectId!}
        available={available}
        onAdded={() => { setShowAdd(false); reload(); }}
        onBack={() => setShowAdd(false)}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-mono text-text-dim uppercase tracking-wider">Integrations</p>
        {available.length > 0 && (
          <button
            onClick={() => setShowAdd(true)}
            className="text-xs font-mono text-accent-blue px-3 py-1.5 rounded-lg border border-accent-blue/30 bg-accent-blue/10 hover:bg-accent-blue/20 transition-colors"
          >
            + Add
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-text-dim font-mono text-sm">loading…</div>
      ) : capabilities.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-text-dim font-mono text-sm mb-4">No integrations yet.</p>
          <button
            onClick={() => setShowAdd(true)}
            className="text-sm font-syne text-accent-blue px-4 py-2 rounded-xl border border-accent-blue/30 bg-accent-blue/10"
          >
            Add your first integration
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([status, items]) => (
            <section key={status}>
              <p className={`text-xs font-mono mb-2 ${STATUS_COLOR[status]}`}>
                {STATUS_LABEL[status]} ({items.length})
              </p>
              <div className="space-y-2">
                {items.map((pc) => (
                  <CapabilityCard
                    key={pc.id}
                    pc={pc}
                    onClick={() => setSelected(pc)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function CapabilityCard({
  pc,
  onClick,
}: {
  pc: ProjectCapability;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-surface-2 rounded-xl border border-border p-4 hover:bg-surface-3 transition-colors active:bg-surface-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[pc.status]}`} />
          <span className="font-syne font-medium text-sm text-text-primary">
            {pc.definition?.name ?? pc.capabilityId}
          </span>
        </div>
        <span className="text-xs font-mono text-text-dim">
          {pc.definition?.category ?? ""}
        </span>
      </div>
      {pc.status === "error" && pc.notes && (
        <p className="text-xs text-red-400 mt-2 ml-5 truncate">{pc.notes}</p>
      )}
    </button>
  );
}

function ConfigureView({
  pc,
  onBack,
}: {
  pc: ProjectCapability;
  onBack: () => void;
}) {
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; output: string | null; error: string | null } | null>(null);
  const [saved, setSaved] = useState(false);

  const def = pc.definition;
  const schema = def?.configSchema as {
    properties?: Record<string, { title?: string; format?: string }>;
    required?: string[];
  } | undefined;
  const fields = Object.entries(schema?.properties ?? {});

  async function saveAndTest() {
    setTesting(true);
    setTestResult(null);
    try {
      await api.capabilities.saveCredentials(pc.id, credentials);
      setSaved(true);
      const result = await api.capabilities.test(pc.id);
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, output: null, error: String(err) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border">
        <button onClick={onBack} className="text-text-dim hover:text-text-primary transition-colors p-1 min-h-[44px] min-w-[44px] flex items-center justify-center">
          ←
        </button>
        <div>
          <p className="font-syne font-medium text-text-primary text-sm">{def?.name}</p>
          <p className="text-xs font-mono text-text-dim">{def?.category}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Status */}
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg mb-4 text-xs font-mono ${
          pc.status === "active" ? "bg-green-500/10 text-green-400" :
          pc.status === "error" ? "bg-red-500/10 text-red-400" :
          "bg-amber-500/10 text-amber-400"
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[pc.status]}`} />
          {STATUS_LABEL[pc.status]}
        </div>

        {/* Setup guide */}
        {def?.setupGuide && (
          <div className="bg-surface-3 rounded-xl p-4 mb-4 border border-border">
            <p className="text-xs font-mono text-text-dim mb-2">setup guide</p>
            <p className="text-sm text-text-secondary font-lora leading-relaxed whitespace-pre-line">
              {def.setupGuide.replace(/^## .+\n\n?/, "")}
            </p>
          </div>
        )}

        {/* Credential fields */}
        {fields.length > 0 && (
          <div className="space-y-3 mb-4">
            <p className="text-xs font-mono text-text-dim">credentials</p>
            {fields.map(([key, field]) => (
              <div key={key}>
                <label className="block text-xs font-mono text-text-secondary mb-1">
                  {field.title ?? key}
                </label>
                <input
                  type={field.format === "password" ? "password" : "text"}
                  value={credentials[key] ?? ""}
                  onChange={(e) =>
                    setCredentials((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  className="w-full bg-surface-3 border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-text-primary placeholder-text-dim focus:outline-none focus:border-white/30 min-h-[44px]"
                  placeholder={field.title ?? key}
                  autoComplete="off"
                />
              </div>
            ))}
          </div>
        )}

        {/* Test result */}
        {testResult && (
          <div className={`rounded-xl p-4 border mb-4 ${
            testResult.success
              ? "bg-green-500/10 border-green-500/20"
              : "bg-red-500/10 border-red-500/20"
          }`}>
            <p className={`text-xs font-mono mb-1 ${testResult.success ? "text-green-400" : "text-red-400"}`}>
              {testResult.success ? "✓ connection verified" : "✗ test failed"}
            </p>
            {(testResult.error || testResult.output) && (
              <p className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-all line-clamp-4">
                {testResult.error ?? testResult.output}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-4 pb-8 pt-3 border-t border-border bg-surface-2">
        {testResult?.success ? (
          <button
            onClick={onBack}
            className="w-full py-3.5 rounded-xl bg-green-500/20 text-green-300 border border-green-500/30 font-syne font-medium text-sm min-h-[48px]"
          >
            Done
          </button>
        ) : (
          <button
            onClick={saveAndTest}
            disabled={testing || fields.some(([k]) => !credentials[k])}
            className="w-full py-3.5 rounded-xl bg-accent-blue/20 text-accent-blue border border-accent-blue/30 font-syne font-medium text-sm hover:bg-accent-blue/30 transition-colors disabled:opacity-40 min-h-[48px]"
          >
            {testing ? "Testing…" : saved ? "Retest" : "Save & Test"}
          </button>
        )}
      </div>
    </div>
  );
}

function AddView({
  projectId,
  available,
  onAdded,
  onBack,
}: {
  projectId: string;
  available: CapabilityDefinition[];
  onAdded: () => void;
  onBack: () => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);

  async function add(defId: string) {
    setAdding(defId);
    try {
      await api.capabilities.addToProject(projectId, defId);
      onAdded();
    } catch {
      setAdding(null);
    }
  }

  const byCategory = available.reduce<Record<string, CapabilityDefinition[]>>((acc, d) => {
    (acc[d.category] ??= []).push(d);
    return acc;
  }, {});

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border">
        <button onClick={onBack} className="text-text-dim p-1 min-h-[44px] min-w-[44px] flex items-center justify-center">
          ←
        </button>
        <p className="font-syne font-medium text-text-primary text-sm">Add Integration</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {Object.entries(byCategory).map(([cat, defs]) => (
          <section key={cat}>
            <p className="text-xs font-mono text-text-dim uppercase tracking-wider mb-2">{cat}</p>
            <div className="space-y-2">
              {defs.map((def) => (
                <button
                  key={def.id}
                  onClick={() => add(def.id)}
                  disabled={adding === def.id}
                  className="w-full text-left bg-surface-2 rounded-xl border border-border p-4 hover:bg-surface-3 transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-syne font-medium text-sm text-text-primary">{def.name}</p>
                    <span className="text-xs font-mono text-accent-blue">
                      {adding === def.id ? "Adding…" : "+ Add"}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary mt-1">{def.description}</p>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

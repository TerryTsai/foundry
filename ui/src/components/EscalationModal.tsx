import { useState, useEffect } from "react";
import { api } from "../api";
import type { Escalation } from "../types";
import { DomainTag, ImpactTag } from "./Tag";

interface EscalationModalProps {
  escalation: Escalation;
  onResolved: () => void;
  onClose: () => void;
}

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "expired";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function EscalationModal({ escalation, onResolved, onClose }: EscalationModalProps) {
  const [mode, setMode] = useState<"view" | "override">("view");
  const [overrideText, setOverrideText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(timeUntil(escalation.timeoutAt));

  useEffect(() => {
    const t = setInterval(() => setCountdown(timeUntil(escalation.timeoutAt)), 60_000);
    return () => clearInterval(t);
  }, [escalation.timeoutAt]);

  async function accept() {
    setSubmitting(true);
    await api.escalations.resolve(escalation.id, { resolvedBy: "ceo" });
    onResolved();
  }

  async function submitOverride() {
    if (!overrideText.trim()) return;
    setSubmitting(true);
    await api.escalations.resolve(escalation.id, {
      resolvedBy: "ceo",
      resolution: overrideText.trim(),
    });
    onResolved();
  }

  async function delay() {
    setSubmitting(true);
    // Delay by resolving with timeout for now — in a later iteration this
    // would extend the timeout_at via a dedicated endpoint
    await api.escalations.resolve(escalation.id, { resolvedBy: "timeout" });
    onResolved();
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />

      {/* Bottom sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-surface-2 rounded-t-2xl border-t border-border max-h-[85dvh] flex flex-col">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-2">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-4 pt-1">
            <div>
              <p className="text-xs font-mono text-text-dim mb-1">escalation · auto-accept in {countdown}</p>
              <h2 className="font-syne font-semibold text-base text-text-primary leading-snug">
                {escalation.topic.replace(/-/g, " ")}
              </h2>
            </div>
            <div className="flex gap-2 flex-shrink-0 mt-0.5">
              <DomainTag domain={escalation.domain} />
              <ImpactTag impact={escalation.impact} />
            </div>
          </div>

          {/* Recommendation */}
          <div className="bg-surface-3 rounded-xl p-4 mb-4 border border-border">
            <p className="text-xs font-mono text-text-dim mb-2">agent recommendation</p>
            <p className="font-lora text-text-primary text-sm leading-relaxed">
              {escalation.draftDecision}
            </p>
          </div>

          {/* Rationale */}
          <div className="mb-4">
            <p className="text-xs font-mono text-text-dim mb-2">rationale</p>
            <p className="text-sm text-text-secondary leading-relaxed font-lora">
              {escalation.draftRationale}
            </p>
          </div>

          {/* Alternatives */}
          {escalation.draftAlternatives && escalation.draftAlternatives.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-mono text-text-dim mb-2">alternatives considered</p>
              <div className="space-y-2">
                {escalation.draftAlternatives.map((alt, i) => (
                  <div key={i} className="bg-surface-3 rounded-lg p-3 border border-border">
                    <p className="text-sm text-text-primary font-medium mb-1">{alt.option}</p>
                    <p className="text-xs text-text-secondary">{alt.tradeoff}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Override input */}
          {mode === "override" && (
            <div className="mb-4">
              <p className="text-xs font-mono text-text-dim mb-2">your decision</p>
              <textarea
                className="w-full bg-surface-3 border border-border rounded-xl p-3 text-sm text-text-primary placeholder-text-dim resize-none focus:outline-none focus:border-white/30 font-lora leading-relaxed"
                rows={3}
                placeholder="State your decision…"
                value={overrideText}
                onChange={(e) => setOverrideText(e.target.value)}
                autoFocus
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 px-5 pb-8 pt-3 border-t border-border bg-surface-2">
          {mode === "view" ? (
            <div className="flex gap-3">
              <button
                onClick={accept}
                disabled={submitting}
                className="flex-1 py-3.5 rounded-xl bg-white/10 text-text-primary font-syne font-medium text-sm hover:bg-white/15 transition-colors disabled:opacity-50 min-h-[48px]"
              >
                Accept
              </button>
              <button
                onClick={() => setMode("override")}
                disabled={submitting}
                className="flex-1 py-3.5 rounded-xl bg-accent-blue/20 text-accent-blue border border-accent-blue/30 font-syne font-medium text-sm hover:bg-accent-blue/30 transition-colors min-h-[48px]"
              >
                Override
              </button>
              <button
                onClick={delay}
                disabled={submitting}
                className="py-3.5 px-4 rounded-xl bg-white/5 text-text-dim font-syne font-medium text-sm hover:bg-white/10 transition-colors min-h-[48px]"
              >
                Delay
              </button>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => setMode("view")}
                className="py-3.5 px-4 rounded-xl bg-white/5 text-text-dim font-syne text-sm min-h-[48px]"
              >
                Back
              </button>
              <button
                onClick={submitOverride}
                disabled={submitting || !overrideText.trim()}
                className="flex-1 py-3.5 rounded-xl bg-accent-blue/20 text-accent-blue border border-accent-blue/30 font-syne font-medium text-sm hover:bg-accent-blue/30 transition-colors disabled:opacity-40 min-h-[48px]"
              >
                Submit Override
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

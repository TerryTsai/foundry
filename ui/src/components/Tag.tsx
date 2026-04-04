interface TagProps {
  label: string;
  color?: string; // tailwind bg class or hex
  className?: string;
}

const DOMAIN_COLORS: Record<string, string> = {
  product: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  engineering: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  marketing: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  business: "bg-green-500/20 text-green-300 border-green-500/30",
  design: "bg-pink-500/20 text-pink-300 border-pink-500/30",
};

const IMPACT_COLORS: Record<string, string> = {
  high: "bg-red-500/20 text-red-300 border-red-500/30",
  medium: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  low: "bg-green-500/20 text-green-300 border-green-500/30",
};

export function DomainTag({ domain }: { domain: string }) {
  const colors = DOMAIN_COLORS[domain] ?? "bg-white/10 text-white/60 border-white/20";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border ${colors}`}>
      {domain}
    </span>
  );
}

export function ImpactTag({ impact }: { impact: string }) {
  const colors = IMPACT_COLORS[impact] ?? "bg-white/10 text-white/60 border-white/20";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border ${colors}`}>
      {impact}
    </span>
  );
}

export function MadeByTag({ madeBy }: { madeBy: string }) {
  const label = madeBy === "agent" ? "agent" : madeBy === "ceo" ? "you" : madeBy === "ceo-override" ? "override" : "timeout";
  const colors = madeBy === "agent"
    ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
    : madeBy === "ceo-override"
    ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
    : "bg-white/10 text-white/60 border-white/20";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border ${colors}`}>
      {label}
    </span>
  );
}

export function Tag({ label, className = "" }: TagProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-white/10 text-white/60 border border-white/20 ${className}`}>
      {label}
    </span>
  );
}

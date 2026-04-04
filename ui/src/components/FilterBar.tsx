interface FilterOption {
  value: string;
  label: string;
}

interface FilterBarProps {
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
}

export function FilterBar({ options, value, onChange }: FilterBarProps) {
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-none px-4 py-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-syne font-medium transition-colors min-h-[36px] ${
            value === opt.value
              ? "bg-white/15 text-white border border-white/30"
              : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white/80"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

type Variant = 'primary' | 'secondary' | 'destructive'

const variants: Record<Variant, string> = {
  primary:     'bg-zinc-100 text-zinc-900',
  secondary:   'bg-zinc-800 text-zinc-400',
  destructive: 'border border-zinc-800 text-zinc-600 active:text-red-400 active:border-red-800',
}

interface ActionButtonProps {
  label: string
  variant?: Variant
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
  className?: string
}

export function ActionButton({
  label,
  variant = 'primary',
  onClick,
  type = 'button',
  disabled,
  className = '',
}: ActionButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`font-mono text-xs uppercase tracking-wider py-2.5 active:opacity-75 transition-opacity disabled:opacity-30 ${variants[variant]} ${className}`}
    >
      {label}
    </button>
  )
}

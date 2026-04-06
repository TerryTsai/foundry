type Variant = 'primary' | 'secondary' | 'destructive'

const variants: Record<Variant, string> = {
  primary:     'bg-zinc-100 text-zinc-900 hover:bg-white',
  secondary:   'bg-zinc-800 text-zinc-300 hover:bg-zinc-700',
  destructive: 'border border-zinc-800 text-zinc-500 active:text-red-400 active:border-red-800',
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
      className={`text-sm font-medium py-2.5 px-4 rounded active:opacity-75 transition-opacity disabled:opacity-30 ${variants[variant]} ${className}`}
    >
      {label}
    </button>
  )
}

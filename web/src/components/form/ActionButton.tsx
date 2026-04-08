type Variant = 'primary' | 'secondary' | 'destructive'

const variants: Record<Variant, string> = {
  primary:     'bg-sky-400 text-zinc-950 font-semibold active:bg-sky-300',
  secondary:   'border border-zinc-400 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 active:border-zinc-500 dark:active:border-zinc-500 active:text-zinc-700 dark:active:text-zinc-200',
  destructive: 'bg-red-500/10 border border-red-500/25 text-red-500 dark:text-red-400 active:bg-red-500/20 active:border-red-500/40',
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
  label, variant = 'primary', onClick, type = 'button', disabled, className = '',
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

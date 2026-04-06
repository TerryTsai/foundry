export const inputCls = 'w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700/60 text-zinc-900 dark:text-zinc-200 text-[16px] px-3 py-2 rounded focus:border-zinc-500 dark:focus:border-zinc-500 transition-colors'

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />
}

export const inputCls = 'w-full bg-zinc-900 border border-zinc-700/60 text-zinc-200 text-sm px-3 py-2 rounded focus:border-zinc-500 transition-colors'

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />
}

export const inputCls = 'w-full bg-zinc-950 border border-zinc-700 text-zinc-200 font-mono text-base px-3 py-2 focus:border-zinc-500 transition-colors'

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />
}

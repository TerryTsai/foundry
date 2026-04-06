import { Inbox } from 'lucide-react'

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center gap-3">
      <Inbox size={28} className="text-zinc-300 dark:text-zinc-700" strokeWidth={1.25} />
      <p className="text-sm text-zinc-400 dark:text-zinc-500">{message}</p>
    </div>
  )
}

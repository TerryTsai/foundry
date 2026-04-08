import { useShell } from '../../Shell.js'
import { FilesView } from '../../views/FilesView.js'

export function FilesPage() {
  const { projectId } = useShell()
  return <FilesView projectId={projectId} />
}

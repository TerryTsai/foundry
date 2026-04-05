import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { Shell } from "./components/Shell";
import { DagView } from "./views/DagView";
import { TaskQueueView } from "./views/TaskQueueView";
import { ActivityView } from "./views/ActivityView";
import { CapabilitiesView } from "./views/CapabilitiesView";
import { ArtifactsView } from "./views/ArtifactsView";
import { ConfigView } from "./views/ConfigView";
import { ProjectSelect } from "./views/ProjectSelect";
import { OnboardingView } from "./views/OnboardingView";
import { useProject } from "./hooks/useProject";
import { api } from "./api";

function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, escalations, setEscalations } = useProject(projectId!);

  function handleEscalationResolved() {
    api.escalations.list(projectId!).then(setEscalations).catch(() => {});
  }

  return (
    <Shell
      escalations={escalations}
      onEscalationResolved={handleEscalationResolved}
      projectName={project?.name}
    >
      <Routes>
        <Route path="dag" element={<DagView />} />
        <Route path="tasks" element={<TaskQueueView />} />
        <Route path="artifacts" element={<ArtifactsView />} />
        <Route path="capabilities" element={<CapabilitiesView />} />
        <Route path="activity" element={<ActivityView />} />
        <Route path="config" element={<ConfigView />} />
        {/* Legacy routes kept for backwards compat */}
        <Route path="world" element={<Navigate to={`/${projectId}/dag`} replace />} />
        <Route path="log" element={<Navigate to={`/${projectId}/activity`} replace />} />
        <Route path="*" element={<Navigate to="dag" replace />} />
      </Routes>
    </Shell>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProjectSelect />} />
        <Route path="/new" element={<OnboardingView />} />
        <Route path="/new/:sessionId" element={<OnboardingView />} />
        <Route path="/:projectId/*" element={<ProjectLayout />} />
      </Routes>
    </BrowserRouter>
  );
}

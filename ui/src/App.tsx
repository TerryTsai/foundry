import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { Shell } from "./components/Shell";
import { WorldView } from "./views/WorldView";
import { ActivityView } from "./views/ActivityView";
import { LogView } from "./views/LogView";
import { CapabilitiesView } from "./views/CapabilitiesView";
import { ArtifactsView } from "./views/ArtifactsView";
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
        <Route path="world" element={<WorldView />} />
        <Route path="activity" element={<ActivityView />} />
        <Route path="log" element={<LogView />} />
        <Route path="capabilities" element={<CapabilitiesView />} />
        <Route path="artifacts" element={<ArtifactsView />} />
        <Route path="*" element={<Navigate to="world" replace />} />
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

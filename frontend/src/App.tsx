import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './shell/AppShell';
import { CurrentStudyProvider } from './shell/currentStudy';
import { StudyList } from './routes/StudyList';
import { StudyViewer } from './routes/StudyViewer';
import { ProvenanceView } from './routes/ProvenanceView';
import { ServersView } from './routes/ServersView';

export function App() {
  return (
    <CurrentStudyProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<StudyList />} />
          <Route path="study/:studyKey" element={<StudyViewer />} />
          <Route path="provenance" element={<ProvenanceView />} />
          <Route path="provenance/:studyKey" element={<ProvenanceView />} />
          <Route path="servers" element={<ServersView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </CurrentStudyProvider>
  );
}

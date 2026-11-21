import { ChatWorkspace } from './components/chat/ChatWorkspace';
import { SettingsWorkspace } from './components/settings/SettingsWorkspace';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { useWorkspace, WorkspaceProvider } from './contexts/WorkspaceContext';
import { AppLayout } from './layouts/AppLayout';

function WorkspaceRouter() {
  const { activeRoute } = useWorkspace();

  switch (activeRoute) {
    case 'settings':
      return <SettingsWorkspace />;
    case 'chat':
    default:
      return <ChatWorkspace />;
  }
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <WorkspaceProvider>
          <AppLayout>
            <WorkspaceRouter />
          </AppLayout>
        </WorkspaceProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}

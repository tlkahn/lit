import { useEffect, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { ContentArea } from "./components/ContentArea";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ContentErrorFallback } from "./components/ContentErrorFallback";
import { WorkspaceChooser } from "./components/WorkspaceChooser";
import { MenuBar } from "./components/MenuBar";
import { useTheme } from "./hooks/useTheme";
import { useSidebarPosition } from "./hooks/useSidebarPosition";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useWorkspaceStore, getRecentWorkspaces } from "./stores/workspace";
import { useThemeStore } from "./stores/theme";
import { readPage, getInitialWorkspace, getPendingWorkspace } from "./lib/ipc";

function App() {
  const { theme, toggleTheme } = useTheme();
  const { position, togglePosition } = useSidebarPosition();
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);
  const initThemes = useThemeStore((s) => s.loadThemes);

  useEffect(() => {
    initThemes();
  }, [initThemes]);

  useEffect(() => {
    if (workspacePath) return;
    const init = async () => {
      const pending = await getPendingWorkspace().catch(() => null);
      if (pending) {
        openWorkspace(pending);
        return;
      }
      const cliPath = await getInitialWorkspace().catch(() => null);
      if (cliPath) {
        openWorkspace(cliPath);
        return;
      }
      const recent = getRecentWorkspaces();
      if (recent.length > 0) {
        openWorkspace(recent[0]!);
      }
    };
    init();
  }, [openWorkspace, workspacePath]);

  const handleCurrentPageModified = useCallback(async () => {
    if (!currentPagePath) return;
    try {
      const content = await readPage(currentPagePath);
      void content;
    } catch {
      // page may have been deleted
    }
  }, [currentPagePath]);

  useFileWatcher(handleCurrentPageModified);

  if (!workspacePath) {
    return <WorkspaceChooser />;
  }

  return (
    <div className="flex h-screen flex-col bg-bg-primary">
      <MenuBar theme={theme} toggleTheme={toggleTheme} position={position} togglePosition={togglePosition} />
      <div className={`flex min-h-0 flex-1 ${position === "right" ? "flex-row-reverse" : "flex-row"}`}>
        <Sidebar />
        <div className="flex min-h-0 flex-1 flex-col">
          <ErrorBoundary fallback={ContentErrorFallback} resetKey={currentPagePath}>
            <ContentArea />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}

export default App;

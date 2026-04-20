import { useEffect, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { ContentArea } from "./components/ContentArea";
import { WorkspaceChooser } from "./components/WorkspaceChooser";
import { ThemeToggle } from "./components/ThemeToggle";
import { SidebarPositionToggle } from "./components/SidebarPositionToggle";
import { useTheme } from "./hooks/useTheme";
import { useSidebarPosition } from "./hooks/useSidebarPosition";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useWorkspaceStore, getSavedWorkspacePath } from "./stores/workspace";
import { readPage, getInitialWorkspace } from "./lib/ipc";

function App() {
  const { theme, toggleTheme } = useTheme();
  const { position, togglePosition } = useSidebarPosition();
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);

  useEffect(() => {
    if (workspacePath) return;
    const init = async () => {
      const cliPath = await getInitialWorkspace().catch(() => null);
      if (cliPath) {
        openWorkspace(cliPath);
        return;
      }
      const saved = getSavedWorkspacePath();
      if (saved) {
        openWorkspace(saved);
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
    <div className={`flex h-screen bg-white dark:bg-neutral-900 ${position === "right" ? "flex-row-reverse" : "flex-row"}`}>
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-end gap-2 border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-700 dark:bg-neutral-800">
          <SidebarPositionToggle position={position} onToggle={togglePosition} />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </header>
        <ContentArea />
      </div>
    </div>
  );
}

export default App;

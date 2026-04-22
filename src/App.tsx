import { useEffect, useState, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { ContentArea } from "./components/ContentArea";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ContentErrorFallback } from "./components/ContentErrorFallback";
import { WorkspaceChooser } from "./components/WorkspaceChooser";
import { useTheme } from "./hooks/useTheme";
import { useSidebarPosition } from "./hooks/useSidebarPosition";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useWorkspaceStore, getRecentWorkspaces } from "./stores/workspace";
import { useThemeStore } from "./stores/theme";
import { usePreferencesStore } from "./stores/preferences";
import { getInitialWorkspace, getPendingWorkspace } from "./lib/ipc";
import { HeadingQuickSwitcher } from "./components/HeadingQuickSwitcher";

function App() {
  useTheme();
  const { position } = useSidebarPosition();
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);
  const triggerReload = useWorkspaceStore((s) => s.triggerReload);
  const initThemes = useThemeStore((s) => s.loadThemes);
  const loadPreferences = usePreferencesStore((s) => s.loadPreferences);
  const colorTheme = usePreferencesStore((s) => s.colorTheme);
  const syncFromPreferences = useThemeStore((s) => s.syncFromPreferences);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  useEffect(() => {
    initThemes();
  }, [initThemes]);

  useEffect(() => {
    syncFromPreferences();
  }, [colorTheme, syncFromPreferences]);

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

  const currentPageHeadings = useWorkspaceStore((s) => s.currentPageHeadings);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);

  useEffect(() => {
    const handler = () => setQuickSwitcherOpen((prev) => !prev);
    window.addEventListener("lit:toggle-quick-switcher", handler);
    return () => window.removeEventListener("lit:toggle-quick-switcher", handler);
  }, []);

  const handleQuickSwitcherSelect = useCallback((line: number) => {
    window.dispatchEvent(
      new CustomEvent("lit:scroll-to-line", { detail: { line, cursor: true } }),
    );
  }, []);

  useFileWatcher(triggerReload);

  if (!workspacePath) {
    return <WorkspaceChooser />;
  }

  return (
    <div className="flex h-screen flex-col bg-bg-primary">
      <div className={`flex min-h-0 flex-1 ${position === "right" ? "flex-row-reverse" : "flex-row"}`}>
        <Sidebar />
        <div className="flex min-h-0 flex-1 flex-col">
          <ErrorBoundary fallback={ContentErrorFallback} resetKey={currentPagePath}>
            <ContentArea />
          </ErrorBoundary>
        </div>
      </div>
      <HeadingQuickSwitcher
        open={quickSwitcherOpen}
        onClose={() => setQuickSwitcherOpen(false)}
        onSelect={handleQuickSwitcherSelect}
        headings={currentPageHeadings}
      />
    </div>
  );
}

export default App;

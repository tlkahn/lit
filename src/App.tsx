import { useEffect, useState, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { ContentArea } from "./components/ContentArea";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ContentErrorFallback } from "./components/ContentErrorFallback";
import { WorkspaceChooser } from "./components/WorkspaceChooser";
import { StatusBar } from "./components/StatusBar";
import { useTheme } from "./hooks/useTheme";
import { useSidebarPosition } from "./hooks/useSidebarPosition";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useWorkspaceStore, getRecentWorkspaces } from "./stores/workspace";
import { useThemeStore } from "./stores/theme";
import { usePreferencesStore } from "./stores/preferences";
import { useFocusModeStore } from "./stores/focusMode";
import { getStartupContext } from "./lib/ipc";
import { HeadingQuickSwitcher } from "./components/HeadingQuickSwitcher";
import { CommandPalette } from "./components/CommandPalette";

interface LitCliArgs {
  workspace: string | null;
  file: string | null;
  line: number | null;
  col: number | null;
}

declare global {
  interface Window {
    __LIT_CLI__?: LitCliArgs;
  }
}

function App() {
  useTheme();
  const { position } = useSidebarPosition();
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const selectPageAtLine = useWorkspaceStore((s) => s.selectPageAtLine);
  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);
  const triggerReload = useWorkspaceStore((s) => s.triggerReload);
  const initThemes = useThemeStore((s) => s.loadThemes);
  const loadPreferences = usePreferencesStore((s) => s.loadPreferences);
  const colorTheme = usePreferencesStore((s) => s.colorTheme);
  const syncFromPreferences = useThemeStore((s) => s.syncFromPreferences);
  const focusModeActive = useFocusModeStore((s) => s.active);
  const toggleFocusMode = useFocusModeStore((s) => s.toggleFocusMode);

  useEffect(() => {
    Promise.all([loadPreferences(), initThemes()]);
  }, [loadPreferences, initThemes]);

  useEffect(() => {
    syncFromPreferences();
  }, [colorTheme, syncFromPreferences]);

  useEffect(() => {
    if (workspacePath) return;
    const init = async () => {
      const cliArgs = window.__LIT_CLI__;
      if (cliArgs) {
        delete window.__LIT_CLI__;
        if (cliArgs.workspace) {
          await openWorkspace(cliArgs.workspace);
          if (cliArgs.file) {
            if (cliArgs.line != null) {
              selectPageAtLine(cliArgs.file, cliArgs.line, cliArgs.col ?? undefined, true);
            } else {
              selectPage(cliArgs.file);
            }
          }
          return;
        }
      }
      const ctx = await getStartupContext().catch(() => null);
      if (ctx?.workspace) {
        await openWorkspace(ctx.workspace);
        if (ctx.file) {
          if (ctx.line != null) {
            selectPageAtLine(ctx.file, ctx.line, ctx.col ?? undefined, true);
          } else {
            selectPage(ctx.file);
          }
        }
        return;
      }
      const recent = getRecentWorkspaces();
      if (recent.length > 0) {
        openWorkspace(recent[0]!);
      }
    };
    init();
  }, [openWorkspace, selectPage, selectPageAtLine, workspacePath]);

  const currentPageHeadings = useWorkspaceStore((s) => s.currentPageHeadings);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  useEffect(() => {
    const handler = () => setQuickSwitcherOpen((prev) => !prev);
    window.addEventListener("lit:toggle-quick-switcher", handler);
    return () => window.removeEventListener("lit:toggle-quick-switcher", handler);
  }, []);

  useEffect(() => {
    const handler = () => setCommandPaletteOpen((prev) => !prev);
    window.addEventListener("lit:toggle-command-palette", handler);
    return () => window.removeEventListener("lit:toggle-command-palette", handler);
  }, []);

  const handleQuickSwitcherSelect = useCallback((line: number) => {
    window.dispatchEvent(
      new CustomEvent("lit:scroll-to-line", { detail: { line, cursor: true } }),
    );
  }, []);

  useEffect(() => {
    if (!focusModeActive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        toggleFocusMode();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [focusModeActive, toggleFocusMode]);

  useFileWatcher(triggerReload);

  if (!workspacePath) {
    return <WorkspaceChooser />;
  }

  return (
    <div className={`flex h-screen flex-col bg-bg-primary${focusModeActive ? " focus-mode-zen" : ""}`}>
      <div className={`flex min-h-0 flex-1 ${position === "right" ? "flex-row-reverse" : "flex-row"}`}>
        <Sidebar />
        <div className="flex min-h-0 flex-1 flex-col">
          <ErrorBoundary fallback={ContentErrorFallback} resetKey={currentPagePath}>
            <ContentArea />
          </ErrorBoundary>
        </div>
      </div>
      <StatusBar />
      <HeadingQuickSwitcher
        open={quickSwitcherOpen}
        onClose={() => setQuickSwitcherOpen(false)}
        onSelect={handleQuickSwitcherSelect}
        headings={currentPageHeadings}
      />
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />
    </div>
  );
}

export default App;

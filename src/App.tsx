import { useEffect, useState, useCallback, useRef } from "react";
import { Sidebar, SIDEBAR_WIDTH_PX } from "./components/Sidebar";
import { ContentArea } from "./components/ContentArea";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ContentErrorFallback } from "./components/ContentErrorFallback";
import { WorkspaceChooser } from "./components/WorkspaceChooser";
import { StatusBar } from "./components/StatusBar";
import { LicenseGate } from "./components/LicenseGate";
import { LicenseEntryDialog } from "./components/LicenseEntryDialog";
import { LicenseInfoDialog } from "./components/LicenseInfoDialog";
import { useTheme } from "./hooks/useTheme";
import { useLicenseTitle } from "./hooks/useLicenseTitle";
import { useSidebarPosition } from "./hooks/useSidebarPosition";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useMenuLicenseSync } from "./hooks/useMenuLicenseSync";
import { useWorkspaceStore, getRecentWorkspaces } from "./stores/workspace";
import { useThemeStore } from "./stores/theme";
import { usePreferencesStore } from "./stores/preferences";
import { useFocusModeStore } from "./stores/focusMode";
import { useLicenseStore } from "./stores/license";
import { getStartupContext } from "./lib/ipc";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { HeadingQuickSwitcher } from "./components/HeadingQuickSwitcher";
import { CommandPalette } from "./components/CommandPalette";
import { AnnotationBuilderModal } from "./components/AnnotationBuilderModal";
import { ExportDialog } from "./components/ExportDialog";
import { SettingsModal } from "./components/SettingsModal";
import { useModalLock } from "./hooks/useModalLock";
import { getCurrentEditorView } from "./lib/editorViewRef";
import { annotationToFields, getEditCursorOffset, type AnnotationBuilderEventDetail, type EditRawInfo } from "./lib/annotationDsl";
import type { Annotation, ExportProgress, ExportSummary } from "./lib/ipc";

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
  useLicenseTitle();
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
  const sidebarVisible = usePreferencesStore((s) => s.sidebarVisible);
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
  const [annotationBuilderOpen, setAnnotationBuilderOpen] = useState(false);
  const [annotationBuilderMode, setAnnotationBuilderMode] = useState<"create" | "edit">("create");
  const [editingAnnotation, setEditingAnnotation] = useState<Annotation | undefined>();
  const [editingRange, setEditingRange] = useState<{ from: number; to: number } | undefined>();
  const [selectionText, setSelectionText] = useState<string | undefined>();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialCategory, setSettingsInitialCategory] = useState<"Keyboard Shortcuts" | undefined>();
  const [licenseEntryOpen, setLicenseEntryOpen] = useState(false);
  const [licenseInfoOpen, setLicenseInfoOpen] = useState(false);
  const licenseState = useLicenseStore((s) => s.state);
  const licensedTo = useLicenseStore((s) => s.licensedTo);
  const daysRemaining = useLicenseStore((s) => s.daysRemaining);

  useMenuLicenseSync();

  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      const unBuy = await listen("menu://buy-license", () => {
        openUrl("https://lit.solar/buy");
      });
      if (cancelled) { unBuy(); return; }
      unlisteners.push(unBuy);

      const unEnterKey = await listen("menu://enter-license-key", () => {
        setLicenseEntryOpen(true);
      });
      if (cancelled) { unEnterKey(); return; }
      unlisteners.push(unEnterKey);

      const unInfo = await listen("menu://license-info", () => {
        setLicenseInfoOpen(true);
      });
      if (cancelled) { unInfo(); return; }
      unlisteners.push(unInfo);

      const unPrefs = await listen("menu://open-preferences", () => {
        setSettingsInitialCategory(undefined);
        setSettingsOpen(true);
      });
      if (cancelled) { unPrefs(); return; }
      unlisteners.push(unPrefs);

      const unDeepLink = await listen<string>("license://activate-key", async (event) => {
        const ok = await useLicenseStore.getState().activate(event.payload);
        if (!ok) setLicenseEntryOpen(true);
      });
      if (cancelled) { unDeepLink(); return; }
      unlisteners.push(unDeepLink);
    };

    setup();

    return () => {
      cancelled = true;
      for (const u of unlisteners) u();
    };
  }, []);

  const [exportVisible, setExportVisible] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<ExportSummary | null>(null);
  const exportTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;
    listen<ExportProgress>("lit:export-progress", (event) => {
      setExportVisible(true);
      setExportResult(null);
      setExportProgress(event.payload);
    }).then((fn) => { unlistenProgress = fn; });
    listen<ExportSummary>("lit:export-complete", (event) => {
      setExportResult(event.payload);
      clearTimeout(exportTimerRef.current);
      exportTimerRef.current = setTimeout(() => setExportVisible(false), 2000);
    }).then((fn) => { unlistenComplete = fn; });
    return () => {
      unlistenProgress?.();
      unlistenComplete?.();
      clearTimeout(exportTimerRef.current);
    };
  }, []);

  useModalLock(quickSwitcherOpen);
  useModalLock(commandPaletteOpen);
  useModalLock(annotationBuilderOpen);
  useModalLock(settingsOpen);

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

  useEffect(() => {
    const handler = () => {
      setSettingsInitialCategory(undefined);
      setSettingsOpen(true);
    };
    window.addEventListener("lit:open-settings", handler);
    return () => window.removeEventListener("lit:open-settings", handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      setSettingsInitialCategory("Keyboard Shortcuts");
      setSettingsOpen(true);
    };
    window.addEventListener("lit:open-keyboard-shortcuts", handler);
    return () => window.removeEventListener("lit:open-keyboard-shortcuts", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<AnnotationBuilderEventDetail>).detail;
      if (detail?.mode === "edit" && detail.annotation) {
        setAnnotationBuilderMode("edit");
        setEditingAnnotation(detail.annotation);
        setEditingRange(detail.originalRange);
        setSelectionText(undefined);
      } else {
        setAnnotationBuilderMode("create");
        setEditingAnnotation(undefined);
        setEditingRange(undefined);
        setSelectionText(detail?.selectedText);
      }
      setAnnotationBuilderOpen(true);
    };
    window.addEventListener("lit:open-annotation-builder", handler);
    return () => window.removeEventListener("lit:open-annotation-builder", handler);
  }, []);

  const handleQuickSwitcherSelect = useCallback((line: number) => {
    window.dispatchEvent(
      new CustomEvent("lit:scroll-to-line", { detail: { line, cursor: true } }),
    );
  }, []);

  const handleAnnotationInsert = useCallback((dsl: string) => {
    const view = getCurrentEditorView();
    if (view) {
      if (editingRange) {
        view.dispatch({ changes: { from: editingRange.from, to: editingRange.to, insert: dsl } });
      } else {
        const pos = view.state.selection.main.head;
        view.dispatch({ changes: { from: pos, insert: dsl } });
      }
    }
    setAnnotationBuilderOpen(false);
  }, [editingRange]);

  const handleEditRaw = useCallback((info: EditRawInfo) => {
    const view = getCurrentEditorView();
    setAnnotationBuilderOpen(false);
    if (!view) return;
    if (info.mode === "edit" && editingAnnotation) {
      view.dispatch({ selection: { anchor: editingAnnotation.char_start } });
      view.focus();
    } else {
      const pos = view.state.selection.main.head;
      view.dispatch({ changes: { from: pos, insert: info.draftDsl } });
      const innerPos = pos + getEditCursorOffset(info.draftDsl);
      view.dispatch({ selection: { anchor: innerPos } });
      view.focus();
    }
  }, [editingAnnotation]);

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
    <LicenseGate>
      <div className={`flex h-screen flex-col bg-bg-primary${focusModeActive ? " focus-mode-zen" : ""}`}>
        <div className={`flex min-h-0 flex-1 ${position === "right" ? "flex-row-reverse" : "flex-row"}`}>
          <div
            style={{
              width: sidebarVisible ? `${SIDEBAR_WIDTH_PX}px` : "0px",
              transition: "width 150ms ease-out",
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            <Sidebar />
          </div>
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
        <ExportDialog visible={exportVisible} progress={exportProgress} result={exportResult} />
        {annotationBuilderOpen && (
          <AnnotationBuilderModal
            onClose={() => setAnnotationBuilderOpen(false)}
            onInsert={handleAnnotationInsert}
            onEditRaw={handleEditRaw}
            mode={annotationBuilderMode}
            originalRange={editingRange}
            selectedText={selectionText}
            initialFields={editingAnnotation ? annotationToFields(editingAnnotation) : undefined}
          />
        )}
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} initialCategory={settingsInitialCategory} />
        <LicenseEntryDialog open={licenseEntryOpen} onClose={() => setLicenseEntryOpen(false)} />
        <LicenseInfoDialog open={licenseInfoOpen} licenseState={licenseState} licensedTo={licensedTo} daysRemaining={daysRemaining} onClose={() => setLicenseInfoOpen(false)} />
      </div>
    </LicenseGate>
  );
}

export default App;

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
import { useMarkConfigStore } from "./stores/markConfig";
import { useFocusModeStore } from "./stores/focusMode";
import { useLicenseStore } from "./stores/license";
import { useSecretStoreStore } from "./stores/secretStore";
import { getStartupContext, mergeDocuments, executeSplit } from "./lib/ipc";
import type { MergePlan } from "./lib/ipc";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { usePaneStore, findLeaf } from "./stores/panes";
import { EditorView } from "@codemirror/view";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { HeadingQuickSwitcher } from "./components/HeadingQuickSwitcher";
import { CommandPalette } from "./components/CommandPalette";
import { AnnotationBuilderModal } from "./components/AnnotationBuilderModal";
import { ExportDialog } from "./components/ExportDialog";
import { SettingsModal } from "./components/SettingsModal";
import { PassphraseModal } from "./components/PassphraseModal";
import { useModalLock } from "./hooks/useModalLock";
import { useSubgraphExport } from "./hooks/useSubgraphExport";
import { SubgraphExportPicker } from "./components/SubgraphExportPicker";
import { useBottomPanelEvents } from "./hooks/useBottomPanelEvents";
import { useBottomPanelPosition } from "./hooks/useBottomPanelPosition";

import { BottomPanel } from "./components/BottomPanel";
import { getCurrentEditorView } from "./lib/editorViewRef";
import { annotationToFields, getEditCursorOffset, type AnnotationBuilderEventDetail, type EditRawInfo } from "./lib/annotationDsl";
import type { Annotation, ExportProgress, ExportSummary, PageContent, SplitPlan } from "./lib/ipc";
import { useStatusMessageStore } from "./stores/statusMessage";
import { MergePreviewDialog } from "./components/MergePreviewDialog";
import { SplitPreviewDialog } from "./components/SplitPreviewDialog";
import { AcademicExportDialog } from "./components/AcademicExportDialog";

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
  useBottomPanelEvents();
  const { position } = useSidebarPosition();
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const selectPageAtLine = useWorkspaceStore((s) => s.selectPageAtLine);
  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);
  const triggerReload = useWorkspaceStore((s) => s.triggerReload);
  const initThemes = useThemeStore((s) => s.loadThemes);
  const loadMarkConfig = useMarkConfigStore((s) => s.loadConfig);
  const loadPreferences = usePreferencesStore((s) => s.loadPreferences);
  const colorTheme = usePreferencesStore((s) => s.colorTheme);
  const syncFromPreferences = useThemeStore((s) => s.syncFromPreferences);
  const sidebarVisible = usePreferencesStore((s) => s.sidebarVisible);
  const llmEnabled = usePreferencesStore((s) => s.llmOpenaiApiKeySet || s.llmAnthropicApiKeySet);
  const focusModeActive = useFocusModeStore((s) => s.active);
  const toggleFocusMode = useFocusModeStore((s) => s.toggleFocusMode);
  const { mode: bottomPanelMode, effectiveSide } = useBottomPanelPosition();

  const focusedLeaf = usePaneStore((s) => findLeaf(s.root, s.focusedPaneId));
  const currentPanePage = focusedLeaf?.pagePath ?? null;

  useEffect(() => {
    Promise.all([loadPreferences(), initThemes()]);
  }, [loadPreferences, initThemes]);

  useEffect(() => {
    syncFromPreferences();
  }, [colorTheme, syncFromPreferences]);

  // Mark config is workspace-scoped (reads .lit/marks.toml and requires a
  // registered workspace), so load it on open and reload on workspace switch.
  useEffect(() => {
    if (workspacePath) loadMarkConfig();
  }, [workspacePath, loadMarkConfig]);

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

  const [academicExportOpen, setAcademicExportOpen] = useState(false);
  const [academicExportFormat, setAcademicExportFormat] = useState<"latex" | "pdf" | "html" | "docx">("latex");

  const [mergePreviewOpen, setMergePreviewOpen] = useState(false);
  const [mergePreviewDocs, setMergePreviewDocs] = useState<PageContent[]>([]);
  const [splitPreviewOpen, setSplitPreviewOpen] = useState(false);
  const [splitPreviewPlan, setSplitPreviewPlan] = useState<SplitPlan>({ preamble: null, sections: [] });
  const [splitPreviewPath, setSplitPreviewPath] = useState("");

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

      const unExportLatex = await listen("menu://export-latex", () => {
        setAcademicExportFormat("latex");
        setAcademicExportOpen(true);
      });
      if (cancelled) { unExportLatex(); return; }
      unlisteners.push(unExportLatex);

      const unExportPdf = await listen("menu://export-pdf", () => {
        setAcademicExportFormat("pdf");
        setAcademicExportOpen(true);
      });
      if (cancelled) { unExportPdf(); return; }
      unlisteners.push(unExportPdf);

      const unExportHtml = await listen("menu://export-html", () => {
        setAcademicExportFormat("html");
        setAcademicExportOpen(true);
      });
      if (cancelled) { unExportHtml(); return; }
      unlisteners.push(unExportHtml);

      const unExportDocx = await listen("menu://export-docx", () => {
        setAcademicExportFormat("docx");
        setAcademicExportOpen(true);
      });
      if (cancelled) { unExportDocx(); return; }
      unlisteners.push(unExportDocx);

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

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebviewWindow().listen<{ file: string | null; line: number | null; col: number | null }>(
      "lit:cli-navigate",
      (event) => {
        const { file, line, col } = event.payload;
        if (!file) return;

        const paneState = usePaneStore.getState();
        const leaf = findLeaf(paneState.root, paneState.focusedPaneId);

        if (leaf?.pagePath === file && line == null) return;

        if (leaf?.pagePath === file && line != null) {
          const view = getCurrentEditorView();
          if (view) {
            const fmCount = useWorkspaceStore.getState().currentFrontmatterLineCount;
            const adjustedLine = Math.max(1, line - fmCount);
            const lineNum = Math.min(adjustedLine, view.state.doc.lines);
            const docLine = view.state.doc.line(lineNum);
            const position = docLine.from + Math.min(col ?? 0, docLine.length);
            view.dispatch({
              selection: { anchor: position },
              effects: EditorView.scrollIntoView(position, { y: "center" }),
            });
            view.focus();
          }
          return;
        }

        const ws = useWorkspaceStore.getState();
        if (line != null) {
          ws.selectPageAtLine(file, line, col ?? undefined, true);
        } else {
          ws.selectPage(file);
        }
      },
    ).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useModalLock(quickSwitcherOpen);
  useModalLock(commandPaletteOpen);
  useModalLock(annotationBuilderOpen);
  useModalLock(settingsOpen);
  useModalLock(academicExportOpen);
  useModalLock(mergePreviewOpen);
  useModalLock(splitPreviewOpen);

  const passphrasePromptOpen = useSecretStoreStore((s) => s.promptOpen);
  useModalLock(passphrasePromptOpen);

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
      const detail = (e as CustomEvent<{ docs: PageContent[] }>).detail;
      setMergePreviewDocs(detail.docs);
      setMergePreviewOpen(true);
    };
    window.addEventListener("lit:open-merge-preview", handler);
    return () => window.removeEventListener("lit:open-merge-preview", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ plan: SplitPlan; originalPath: string }>).detail;
      setSplitPreviewPlan(detail.plan);
      setSplitPreviewPath(detail.originalPath);
      setSplitPreviewOpen(true);
    };
    window.addEventListener("lit:open-split-preview", handler);
    return () => window.removeEventListener("lit:open-split-preview", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ format: "latex" | "pdf" | "html" | "docx" }>).detail;
      setAcademicExportFormat(detail?.format ?? "latex");
      setAcademicExportOpen(true);
    };
    window.addEventListener("lit:open-academic-export", handler);
    return () => window.removeEventListener("lit:open-academic-export", handler);
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

  const exportFlow = useSubgraphExport();
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
            <Sidebar onExportNetwork={exportFlow.requestExport} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <ErrorBoundary fallback={ContentErrorFallback} resetKey={currentPagePath}>
              <ContentArea onExportNetwork={exportFlow.requestExport} renderBottomPanel={bottomPanelMode !== "side"} />
            </ErrorBoundary>
          </div>
          {bottomPanelMode === "side" && (
            <BottomPanel pageId={currentPanePage ?? undefined} direction={effectiveSide} />
          )}
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
        <AcademicExportDialog open={academicExportOpen} onClose={() => setAcademicExportOpen(false)} initialFormat={academicExportFormat} />
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} initialCategory={settingsInitialCategory} />
        <PassphraseModal />
        <LicenseEntryDialog open={licenseEntryOpen} onClose={() => setLicenseEntryOpen(false)} />
        <LicenseInfoDialog open={licenseInfoOpen} licenseState={licenseState} licensedTo={licensedTo} daysRemaining={daysRemaining} onClose={() => setLicenseInfoOpen(false)} />
        <SubgraphExportPicker
          open={exportFlow.pickerOpen}
          onExport={exportFlow.handlePickerExport}
          onCancel={exportFlow.handlePickerCancel}
        />
        <MergePreviewDialog
          open={mergePreviewOpen}
          docs={mergePreviewDocs}
          llmEnabled={llmEnabled}
          onConfirm={async (plan: MergePlan, ordering: number[]) => {
            setMergePreviewOpen(false);
            try {
              const paths = mergePreviewDocs.map((d) => d.meta.relative_path);
              const mergedPath = await mergeDocuments(paths, plan.title, ordering);
              useWorkspaceStore.getState().selectPage(mergedPath);
              useStatusMessageStore.getState().show("Documents merged");
            } catch (err) {
              useStatusMessageStore.getState().show(String(err), "error");
            }
          }}
          onCancel={() => setMergePreviewOpen(false)}
        />
        <SplitPreviewDialog
          open={splitPreviewOpen}
          plan={splitPreviewPlan}
          originalPath={splitPreviewPath}
          onConfirm={async () => {
            setSplitPreviewOpen(false);
            try {
              const createdPaths = await executeSplit(splitPreviewPath);
              const first = createdPaths[0];
              if (first) {
                useWorkspaceStore.getState().selectPage(first);
              }
              useStatusMessageStore.getState().show("Document split");
            } catch (err) {
              useStatusMessageStore.getState().show(String(err), "error");
            }
          }}
          onCancel={() => setSplitPreviewOpen(false)}
        />
      </div>
    </LicenseGate>
  );
}

export default App;

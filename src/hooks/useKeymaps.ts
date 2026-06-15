import { useEffect, useState } from "react";
import type { KeyBinding as CM6KeyBinding } from "@codemirror/view";
import { getKeymaps } from "../lib/ipc";
import { resolveKeymaps } from "../lib/keymapResolver";
import { registerCommand, registerHandler, hasCommand } from "../lib/commandRegistry";
import { toggleBold, toggleItalic, insertLink, toggleComment } from "../editor/editorCommands";
import { selectNextOccurrence, findNext, findPrevious } from "@codemirror/search";
import { navigateBack, navigateForward } from "../editor/jumpHistory";
import { openInExternalEditor, setPreference } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";
import { usePreferencesStore } from "../stores/preferences";
import { useFocusModeStore } from "../stores/focusMode";
import { getCurrentEditorView, getPaneView, setFocusedPane, isFocusInsideContentPane } from "../lib/editorViewRef";
import { usePaneStore, collectLeaves, MAX_PANES } from "../stores/panes";
import { annotationDataField, findAnnotationAtCursor } from "../editor/livePreview/annotationState";
import type { AnnotationBuilderEventDetail } from "../lib/annotationDsl";
import { canFire } from "../lib/fireClassification";
import { fireAnnotation } from "../lib/fireOrchestrator";
import { batchFireReplacingAnnotations } from "../lib/batchFire";
import type { EditorView } from "@codemirror/view";

function transferDomFocus() {
  const id = usePaneStore.getState().focusedPaneId;
  setFocusedPane(id);
  const view = getPaneView(id);
  if (view) {
    view.focus();
  } else {
    const el = document.querySelector<HTMLElement>(`[data-pane-id="${id}"]`);
    el?.focus();
  }
}

export function ensureCommandsRegistered() {
  if (hasCommand("editor.toggleBold")) return;
  registerHandler("editor.toggleBold", (view) => toggleBold(view as EditorView));
  registerHandler("editor.toggleItalic", (view) => toggleItalic(view as EditorView));
  registerHandler("editor.insertLink", (view) => insertLink(view as EditorView));
  registerHandler("editor.toggleComment", (view) => toggleComment(view as EditorView));
  registerHandler("editor.openInExternalEditor", (view) => {
    const v = view as EditorView;
    const pos = v.state.selection.main.head;
    const line = v.state.doc.lineAt(pos);
    const { currentPagePath, currentFrontmatterLineCount } = useWorkspaceStore.getState();
    if (currentPagePath) {
      openInExternalEditor(currentPagePath, line.number + currentFrontmatterLineCount, pos - line.from + 1);
    }
  });
  registerHandler("editor.navigateBack", (view) => navigateBack(view as EditorView));
  registerHandler("editor.navigateForward", (view) => navigateForward(view as EditorView));
  registerHandler("editor.selectNextOccurrence", (view) => selectNextOccurrence(view as EditorView));
  registerHandler("editor.findNext", (view) => findNext(view as EditorView));
  registerHandler("editor.findPrevious", (view) => findPrevious(view as EditorView));
  registerHandler("app.gotoHeading", () => {
    window.dispatchEvent(new CustomEvent("lit:toggle-quick-switcher"));
  });
  registerCommand({
    id: "app.toggleFocusMode",
    label: "Toggle Focus Mode",
    keywords: ["focus", "zen", "distraction"],
    icon: "\u{1F9D8}",
    action: () => {
      useFocusModeStore.getState().toggleFocusMode();
    },
  });
  registerCommand({
    id: "workbench.toggleSideBar",
    label: "Toggle Sidebar",
    keywords: ["sidebar", "side", "panel", "hide", "show"],
    action: () => {
      const current = usePreferencesStore.getState().sidebarVisible;
      usePreferencesStore.setState({ sidebarVisible: !current });
      setPreference("workbench.sideBar.visible", !current).catch(console.error);
    },
  });
  registerHandler("panel.toggleBottom", () => {
    window.dispatchEvent(new CustomEvent("lit:toggle-bottom-panel"));
  });
  registerHandler("panel.toggleAnnotations", () => {
    window.dispatchEvent(new CustomEvent("lit:toggle-annotation-panel"));
  });
  registerHandler("app.commandPalette", () => {
    window.dispatchEvent(new CustomEvent("lit:toggle-command-palette"));
  });
  registerCommand({
    id: "app.openKeyboardShortcuts",
    label: "Keyboard Shortcuts",
    keywords: ["shortcut", "keybinding", "hotkey", "keymap"],
    action: () => {
      window.dispatchEvent(new CustomEvent("lit:open-keyboard-shortcuts"));
    },
  });
  registerCommand({
    id: "app.showEditorView",
    label: "Show Editor View",
    keywords: ["editor", "text", "write"],
    action: () => {
      window.dispatchEvent(new CustomEvent("lit:set-view-mode", { detail: "editor" }));
    },
  });
  registerCommand({
    id: "app.showMindmapView",
    label: "Show Mindmap View",
    keywords: ["mindmap", "tree", "outline"],
    action: () => {
      window.dispatchEvent(new CustomEvent("lit:set-view-mode", { detail: "mindmap" }));
    },
  });
  registerCommand({
    id: "app.showGraphView",
    label: "Show Graph View",
    keywords: ["graph", "network", "visualize"],
    action: () => {
      window.dispatchEvent(new CustomEvent("lit:set-view-mode", { detail: "graph" }));
    },
  });
  registerCommand({
    id: "app.showCardboxView",
    label: "Show Cardbox View",
    keywords: ["cardbox", "annotations", "cards", "zettelkasten"],
    action: () => {
      window.dispatchEvent(new CustomEvent("lit:set-view-mode", { detail: "cardbox" }));
    },
  });
  registerCommand({
    id: "app.showLocalGraph",
    label: "Show Local Graph",
    keywords: ["graph", "local", "neighborhood"],
    when: () => useWorkspaceStore.getState().currentPagePath != null,
    action: () => {
      window.dispatchEvent(new CustomEvent("lit:toggle-graph-view", { detail: { mode: "local" } }));
    },
  });
  registerCommand({
    id: "pane.splitRight",
    label: "Split Pane Right",
    keywords: ["split", "pane", "vertical", "right"],
    when: () => collectLeaves(usePaneStore.getState().root).length < MAX_PANES,
    action: () => {
      const { focusedPaneId } = usePaneStore.getState();
      usePaneStore.getState().splitPane(focusedPaneId, "horizontal");
    },
  });
  registerCommand({
    id: "pane.splitDown",
    label: "Split Pane Down",
    keywords: ["split", "pane", "horizontal", "down"],
    when: () => collectLeaves(usePaneStore.getState().root).length < MAX_PANES,
    action: () => {
      const { focusedPaneId } = usePaneStore.getState();
      usePaneStore.getState().splitPane(focusedPaneId, "vertical");
    },
  });
  registerCommand({
    id: "pane.focusNext",
    label: "Focus Next Pane",
    keywords: ["pane", "focus", "next", "right"],
    when: () => collectLeaves(usePaneStore.getState().root).length > 1,
    action: () => {
      usePaneStore.getState().focusNext();
      transferDomFocus();
    },
  });
  registerCommand({
    id: "pane.focusPrev",
    label: "Focus Previous Pane",
    keywords: ["pane", "focus", "previous", "left"],
    when: () => collectLeaves(usePaneStore.getState().root).length > 1,
    action: () => {
      usePaneStore.getState().focusPrev();
      transferDomFocus();
    },
  });
  registerCommand({
    id: "pane.close",
    label: "Close Pane",
    keywords: ["pane", "close"],
    action: () => {
      const { focusedPaneId } = usePaneStore.getState();
      usePaneStore.getState().closePane(focusedPaneId);
      transferDomFocus();
    },
  });
  registerCommand({
    id: "pane.focusContentNext",
    label: "Focus Next Content Pane",
    keywords: ["pane", "focus", "next", "content", "editor"],
    action: () => {
      if (isFocusInsideContentPane()) {
        usePaneStore.getState().focusNext();
      }
      transferDomFocus();
    },
  });
  registerCommand({
    id: "pane.focusContentPrev",
    label: "Focus Previous Content Pane",
    keywords: ["pane", "focus", "previous", "content", "editor"],
    action: () => {
      if (isFocusInsideContentPane()) {
        usePaneStore.getState().focusPrev();
      }
      transferDomFocus();
    },
  });
  registerCommand({
    id: "app.insertAnnotation",
    label: "Insert Annotation",
    keywords: ["annotation", "annotate", "note"],
    icon: "\u{1F4AC}",
    when: () => {
      const s = useWorkspaceStore.getState();
      return s.workspacePath !== null && s.currentPagePath !== null;
    },
    action: () => {
      const view = getCurrentEditorView();
      if (view) {
        const annotations = view.state.field(annotationDataField, false) ?? [];
        const pos = view.state.selection.main.head;
        const ann = findAnnotationAtCursor(annotations, pos);
        if (ann) {
          window.dispatchEvent(
            new CustomEvent<AnnotationBuilderEventDetail>("lit:open-annotation-builder", {
              detail: {
                mode: "edit",
                annotation: ann,
                originalRange: { from: ann.char_start, to: ann.char_end },
              },
            }),
          );
          return;
        }
        const sel = view.state.selection.main;
        const selectedText = sel.from !== sel.to ? view.state.sliceDoc(sel.from, sel.to) : undefined;
        window.dispatchEvent(
          new CustomEvent<AnnotationBuilderEventDetail>("lit:open-annotation-builder", {
            detail: { mode: "create", selectedText, originalRange: selectedText ? { from: sel.from, to: sel.to } : undefined },
          }),
        );
      } else {
        window.dispatchEvent(new CustomEvent("lit:open-annotation-builder"));
      }
    },
  });
  registerCommand({
    id: "app.fireAnnotation",
    label: "Fire Annotation at Cursor",
    keywords: ["fire", "llm", "annotation", "run"],
    when: () => {
      const view = getCurrentEditorView();
      if (!view) return false;
      const annotations = view.state.field(annotationDataField, false) ?? [];
      const pos = view.state.selection.main.head;
      const ann = findAnnotationAtCursor(annotations, pos);
      return ann != null && canFire(ann.annotation_type);
    },
    action: () => {
      const view = getCurrentEditorView();
      if (!view) return;
      const annotations = view.state.field(annotationDataField, false) ?? [];
      const pos = view.state.selection.main.head;
      const ann = findAnnotationAtCursor(annotations, pos);
      if (ann && canFire(ann.annotation_type)) {
        fireAnnotation({ view, annotation: ann });
      }
    },
  });
  registerCommand({
    id: "app.batchFireAnnotations",
    label: "Fire All Replacing Annotations",
    keywords: ["fire", "batch", "llm", "all", "replacing"],
    when: () => getCurrentEditorView() != null,
    action: () => {
      const view = getCurrentEditorView();
      if (view) batchFireReplacingAnnotations(view);
    },
  });
}

export function useKeymaps(): {
  editorBindings: CM6KeyBinding[];
  loading: boolean;
} {
  const [editorBindings, setEditorBindings] = useState<CM6KeyBinding[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ensureCommandsRegistered();

    let cancelled = false;
    getKeymaps()
      .then((merged) => {
        if (cancelled) return;
        const resolved = resolveKeymaps(merged);
        setEditorBindings(resolved.editorBindings);
        setLoading(false);
      })
      .catch((err) => {
        console.error("[useKeymaps] failed to load keymaps:", err);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const reload = () => {
      getKeymaps()
        .then((merged) => {
          const resolved = resolveKeymaps(merged);
          setEditorBindings(resolved.editorBindings);
        })
        .catch((err) => {
          console.error("[useKeymaps] failed to reload keymaps:", err);
        });
    };
    window.addEventListener("lit:keymaps-changed", reload);
    return () => window.removeEventListener("lit:keymaps-changed", reload);
  }, []);

  return { editorBindings, loading };
}

import { useEffect, useState, useRef } from "react";
import type { KeyBinding as CM6KeyBinding } from "@codemirror/view";
import { getKeymaps } from "../lib/ipc";
import { resolveKeymaps, type AppBinding } from "../lib/keymapResolver";
import { registerCommand, registerHandler, hasCommand, executeCommand } from "../lib/commandRegistry";
import { toggleBold, toggleItalic, insertLink, toggleComment } from "../editor/editorCommands";
import { navigateBack, navigateForward } from "../editor/jumpHistory";
import { openInExternalEditor } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";
import { useFocusModeStore } from "../stores/focusMode";
import { getCurrentEditorView } from "../lib/editorViewRef";
import { annotationDataField, findAnnotationAtCursor } from "../editor/livePreview/annotationState";
import type { AnnotationBuilderEventDetail } from "../lib/annotationDsl";
import type { EditorView } from "@codemirror/view";

function ensureCommandsRegistered() {
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
            detail: { mode: "create", selectedText },
          }),
        );
      } else {
        window.dispatchEvent(new CustomEvent("lit:open-annotation-builder"));
      }
    },
  });
}

function keyStringFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("Mod");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");

  const key = e.key;
  if (!["Meta", "Control", "Shift", "Alt"].includes(key)) {
    parts.push(key.length === 1 ? key.toLowerCase() : key);
  }

  return parts.join("-");
}

export function useKeymaps(): {
  editorBindings: CM6KeyBinding[];
  loading: boolean;
} {
  const [editorBindings, setEditorBindings] = useState<CM6KeyBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const appBindingsRef = useRef<AppBinding[]>([]);

  useEffect(() => {
    ensureCommandsRegistered();

    let cancelled = false;
    getKeymaps()
      .then((merged) => {
        if (cancelled) return;
        const resolved = resolveKeymaps(merged);
        setEditorBindings(resolved.editorBindings);
        appBindingsRef.current = resolved.appBindings;
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
    const handler = (e: KeyboardEvent) => {
      const pressed = keyStringFromEvent(e);
      for (const binding of appBindingsRef.current) {
        if (binding.key === pressed) {
          e.preventDefault();
          executeCommand(binding.command);
          return;
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return { editorBindings, loading };
}

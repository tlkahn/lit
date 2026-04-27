import { useEffect, useState, useRef } from "react";
import type { KeyBinding as CM6KeyBinding } from "@codemirror/view";
import { getKeymaps } from "../lib/ipc";
import { resolveKeymaps, type AppBinding } from "../lib/keymapResolver";
import { commandRegistry } from "../lib/commands";
import { toggleBold, toggleItalic, insertLink, toggleComment } from "../editor/editorCommands";
import { navigateBack, navigateForward } from "../editor/jumpHistory";
import { openInExternalEditor } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";
import { useFocusModeStore } from "../stores/focusMode";
import type { EditorView } from "@codemirror/view";

function ensureCommandsRegistered() {
  if (commandRegistry.has("editor.toggleBold")) return;
  commandRegistry.register("editor.toggleBold", (view) => toggleBold(view as EditorView));
  commandRegistry.register("editor.toggleItalic", (view) => toggleItalic(view as EditorView));
  commandRegistry.register("editor.insertLink", (view) => insertLink(view as EditorView));
  commandRegistry.register("editor.toggleComment", (view) => toggleComment(view as EditorView));
  commandRegistry.register("editor.openInExternalEditor", (view) => {
    const v = view as EditorView;
    const pos = v.state.selection.main.head;
    const line = v.state.doc.lineAt(pos);
    const lineNumber = line.number;
    const col = pos - line.from + 1;
    const currentPagePath = useWorkspaceStore.getState().currentPagePath;
    if (currentPagePath) {
      openInExternalEditor(currentPagePath, lineNumber, col);
    }
  });
  commandRegistry.register("editor.navigateBack", (view) => navigateBack(view as EditorView));
  commandRegistry.register("editor.navigateForward", (view) => navigateForward(view as EditorView));
  commandRegistry.register("app.gotoHeading", () => {
    window.dispatchEvent(new CustomEvent("lit:toggle-quick-switcher"));
  });
  commandRegistry.register("app.toggleFocusMode", () => {
    useFocusModeStore.getState().toggleFocusMode();
  });
  commandRegistry.register("panel.toggleBottom", () => {
    window.dispatchEvent(new CustomEvent("lit:toggle-bottom-panel"));
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
          commandRegistry.execute(binding.command);
          return;
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return { editorBindings, loading };
}

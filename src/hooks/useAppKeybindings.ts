import { useEffect, useRef } from "react";
import { getKeymaps } from "../lib/ipc";
import { resolveKeymaps, keyStringFromEvent, normalizeBindingForPlatform, type AppBinding } from "../lib/keymapResolver";
import { executeCommand } from "../lib/commandRegistry";
import { getCurrentEditorView } from "../lib/editorViewRef";
import { ensureCommandsRegistered } from "./useKeymaps";

/**
 * True when the event target is a text-editing element (input, textarea,
 * contenteditable). `!editorFocus` bindings must not fire there: they would
 * hijack native editing shortcuts like Cmd-Z inside search/filter inputs.
 * (CM6 editors are handled separately via getCurrentEditorView().hasFocus.)
 */
function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return true;
  if (t.isContentEditable) return true;
  return t.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]') != null;
}

export function useAppKeybindings(): void {
  const appBindingsRef = useRef<AppBinding[]>([]);

  useEffect(() => {
    ensureCommandsRegistered();

    let cancelled = false;
    getKeymaps()
      .then((merged) => {
        if (cancelled) return;
        const resolved = resolveKeymaps(merged);
        appBindingsRef.current = resolved.appBindings;
      })
      .catch((err) => {
        console.error("[useAppKeybindings] failed to load keymaps:", err);
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
          appBindingsRef.current = resolved.appBindings;
        })
        .catch((err) => {
          console.error("[useAppKeybindings] failed to reload keymaps:", err);
        });
    };
    window.addEventListener("lit:keymaps-changed", reload);
    return () => window.removeEventListener("lit:keymaps-changed", reload);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const pressed = keyStringFromEvent(e);
      for (const binding of appBindingsRef.current) {
        if (normalizeBindingForPlatform(binding.key) === pressed) {
          if (binding.when === "editorFocus" && !getCurrentEditorView()?.hasFocus) continue;
          if (binding.when === "!editorFocus" && getCurrentEditorView()?.hasFocus) continue;
          if (binding.when === "!editorFocus" && isEditableTarget(e.target)) continue;
          e.preventDefault();
          e.stopImmediatePropagation();
          executeCommand(binding.command);
          return;
        }
      }
    };

    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, []);
}

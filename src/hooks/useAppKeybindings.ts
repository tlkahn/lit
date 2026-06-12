import { useEffect, useRef } from "react";
import { getKeymaps } from "../lib/ipc";
import { resolveKeymaps, keyStringFromEvent, normalizeBindingForPlatform, type AppBinding } from "../lib/keymapResolver";
import { executeCommand } from "../lib/commandRegistry";
import { getCurrentEditorView } from "../lib/editorViewRef";
import { ensureCommandsRegistered } from "./useKeymaps";

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
          if (binding.when === "editorFocus" && getCurrentEditorView() == null) continue;
          if (binding.when === "!editorFocus" && getCurrentEditorView() != null) continue;
          const handled = executeCommand(binding.command);
          if (handled) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
          return;
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
}

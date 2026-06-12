import type { KeyBinding as CM6KeyBinding } from "@codemirror/view";
import type { KeyBinding } from "./ipc";
import { hasCommand, executeCommand } from "./commandRegistry";
import { base as w3cBase, shift as w3cShift } from "w3c-keyname";

export const platform = {
  isMac: /Mac|iPhone|iPad|iPod/.test(navigator.platform),
};

// NOTE: Binding resolution is e.key-based (not e.code), so it is
// keyboard-layout-dependent. On US QWERTY, Cmd+Shift+= fires key "+",
// resolved as "Mod-Shift-+". On other layouts the shifted character may
// differ. This is a pre-existing app-wide limitation; do not attempt to
// rewrite to e.code without a full audit of all bindings.
export function keyStringFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (platform.isMac) {
    if (e.metaKey) parts.push("Mod");
    if (e.ctrlKey) parts.push("Ctrl");
  } else {
    if (e.ctrlKey) parts.push("Mod");
    if (e.metaKey) parts.push("Meta");
  }
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");

  const ignoreKey =
    platform.isMac && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey;
  const key =
    (!ignoreKey && e.key) ||
    (e.shiftKey ? w3cShift : w3cBase)[e.keyCode] ||
    e.key ||
    "Unidentified";
  if (!["Meta", "Control", "Shift", "Alt"].includes(key)) {
    parts.push(key.length === 1 ? key.toLowerCase() : key);
  }

  return parts.join("-");
}

export function normalizeBindingForPlatform(key: string): string {
  if (platform.isMac) return key;
  return key.replace(/^Ctrl(?=-)/, "Mod").replace(/-Ctrl(?=-)/, "-Mod");
}

export interface AppBinding {
  key: string;
  command: string;
  when?: string;
}

export interface ResolvedKeymaps {
  editorBindings: CM6KeyBinding[];
  appBindings: AppBinding[];
}

export function resolveKeymaps(merged: KeyBinding[]): ResolvedKeymaps {
  const editorBindings: CM6KeyBinding[] = [];
  const appBindings: AppBinding[] = [];

  for (const binding of merged) {
    if (!hasCommand(binding.command)) continue;

    if (binding.command.startsWith("editor.")) {
      editorBindings.push({
        key: binding.key,
        run: (view) => executeCommand(binding.command, view),
      });
    } else {
      appBindings.push({
        key: binding.key,
        command: binding.command,
        when: binding.when,
      });
    }
  }

  return { editorBindings, appBindings };
}

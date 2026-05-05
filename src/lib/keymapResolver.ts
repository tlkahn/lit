import type { KeyBinding as CM6KeyBinding } from "@codemirror/view";
import type { KeyBinding } from "./ipc";
import { hasCommand, executeCommand } from "./commandRegistry";

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

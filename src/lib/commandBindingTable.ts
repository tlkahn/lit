import type { Command } from "./commandRegistry";
import { getAllCommands } from "./commandRegistry";
import type { KeyBinding } from "./ipc";
import { getKeymaps, getMenuShortcuts } from "./ipc";

export type CommandBindingStatus = "bound" | "unbound" | "unknown-command";

export interface CommandBindingEntry {
  commandId: string;
  command: Command | null;
  bindings: KeyBinding[];
  status: CommandBindingStatus;
}

export function buildCommandBindingTable(
  commands: Command[],
  bindings: KeyBinding[],
): CommandBindingEntry[] {
  const bindingsByCommand = new Map<string, KeyBinding[]>();
  for (const binding of bindings) {
    const list = bindingsByCommand.get(binding.command);
    if (list) {
      list.push(binding);
    } else {
      bindingsByCommand.set(binding.command, [binding]);
    }
  }

  const commandMap = new Map<string, Command>();
  for (const cmd of commands) {
    commandMap.set(cmd.id, cmd);
  }

  const entries: CommandBindingEntry[] = [];
  const seen = new Set<string>();

  for (const cmd of commandMap.values()) {
    seen.add(cmd.id);
    const cmdBindings = bindingsByCommand.get(cmd.id) ?? [];
    entries.push({
      commandId: cmd.id,
      command: cmd,
      bindings: cmdBindings,
      status: cmdBindings.length > 0 ? "bound" : "unbound",
    });
  }

  for (const [commandId, cmdBindings] of bindingsByCommand) {
    if (!seen.has(commandId)) {
      entries.push({
        commandId,
        command: null,
        bindings: cmdBindings,
        status: "unknown-command",
      });
    }
  }

  return entries;
}

export async function fetchCommandBindingTable(): Promise<CommandBindingEntry[]> {
  const [keymaps, menuShortcuts] = await Promise.all([
    getKeymaps(),
    getMenuShortcuts(),
  ]);
  const allBindings = [...keymaps, ...menuShortcuts];
  const commands = getAllCommands();
  return buildCommandBindingTable(commands, allBindings);
}

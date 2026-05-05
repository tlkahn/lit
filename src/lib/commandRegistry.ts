export interface Command {
  id: string;
  label?: string;
  keywords?: string[];
  shortcut?: string;
  icon?: string;
  action: (...args: unknown[]) => boolean | void;
  when?: () => boolean;
}

const commands = new Map<string, Command>();
const groups = new Set<string>();

export function registerCommand(cmd: Command): void {
  commands.set(cmd.id, cmd);
}

export function registerCommands(cmds: Command[]): void {
  for (const cmd of cmds) commands.set(cmd.id, cmd);
}

export function registerOnce(group: string, cmds: Command[]): void {
  if (groups.has(group)) return;
  groups.add(group);
  registerCommands(cmds);
}

export function unregisterCommand(id: string): void {
  commands.delete(id);
}

export function getAllCommands(): Command[] {
  return [...commands.values()];
}

export function getVisibleCommands(query?: string): Command[] {
  let results = [...commands.values()].filter(
    (cmd) => cmd.label != null && (!cmd.when || cmd.when()),
  );
  if (query) {
    const q = query.toLowerCase();
    results = results.filter(
      (cmd) =>
        cmd.label!.toLowerCase().includes(q) ||
        (cmd.keywords ?? []).some((kw) => kw.toLowerCase().includes(q)),
    );
  }
  return results;
}

export function registerHandler(
  id: string,
  handler: (...args: unknown[]) => boolean | void,
): void {
  commands.set(id, { id, action: handler });
}

export function hasCommand(id: string): boolean {
  return commands.has(id);
}

export function executeCommand(id: string, ...args: unknown[]): boolean {
  const cmd = commands.get(id);
  if (!cmd) return false;
  const result = cmd.action(...args);
  return result !== false;
}

export function _clear(): void {
  commands.clear();
  groups.clear();
}

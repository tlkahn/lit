export interface Command {
  id: string;
  label: string;
  keywords: string[];
  shortcut?: string;
  icon?: string;
  action: () => void | Promise<void>;
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
  let results = [...commands.values()].filter((cmd) => !cmd.when || cmd.when());
  if (query) {
    const q = query.toLowerCase();
    results = results.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.keywords.some((kw) => kw.toLowerCase().includes(q)),
    );
  }
  return results;
}

export function executeCommand(id: string): boolean {
  const cmd = commands.get(id);
  if (!cmd) return false;
  cmd.action();
  return true;
}

export function _clear(): void {
  commands.clear();
  groups.clear();
}

import type { PaletteProvider, PaletteResult } from "./paletteRegistry";
import { getVisibleCommands, executeCommand } from "./commandRegistry";

export const commandProvider: PaletteProvider = {
  id: "commands",
  prefix: "!",
  label: "Commands",
  priority: 50,
  async search(query: string): Promise<PaletteResult[]> {
    return getVisibleCommands(query || undefined).map((cmd) => ({
      id: cmd.id,
      title: cmd.label!,
      icon: cmd.icon,
      shortcut: cmd.shortcut,
      section: "Commands",
    }));
  },
  onSelect(result) {
    executeCommand(result.id);
  },
};

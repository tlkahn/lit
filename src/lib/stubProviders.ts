import type { PaletteProvider, PaletteResult } from "./paletteRegistry";

interface Command {
  id: string;
  label: string;
  icon: string;
  action: () => void;
}

const COMMANDS: Command[] = [
  {
    id: "insert-annotation",
    label: "Insert Annotation",
    icon: "✏️",
    action: () => window.dispatchEvent(new CustomEvent("lit:open-annotation-builder")),
  },
];

const COMMAND_MAP = new Map(COMMANDS.map((cmd) => [cmd.id, cmd]));

export const tagProvider: PaletteProvider = {
  id: "tags",
  prefix: "#",
  label: "Tags",
  priority: 30,
  async search(): Promise<PaletteResult[]> {
    return [];
  },
  onSelect() {},
};

export const contentProvider: PaletteProvider = {
  id: "content",
  prefix: "/",
  label: "Content",
  priority: 40,
  async search(): Promise<PaletteResult[]> {
    return [];
  },
  onSelect() {},
};

export const commandProvider: PaletteProvider = {
  id: "commands",
  prefix: "!",
  label: "Commands",
  priority: 50,
  async search(query: string): Promise<PaletteResult[]> {
    const q = query.toLowerCase();
    const matches = COMMANDS.filter((cmd) => !q || cmd.label.toLowerCase().includes(q));
    return matches.map((cmd) => ({
      id: cmd.id,
      title: cmd.label,
      icon: cmd.icon,
      section: "Commands",
    }));
  },
  onSelect(result: PaletteResult) {
    const cmd = COMMAND_MAP.get(result.id);
    if (cmd) cmd.action();
  },
};

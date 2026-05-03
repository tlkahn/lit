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

export const fileProvider: PaletteProvider = {
  id: "files",
  prefix: "$",
  label: "Files",
  priority: 10,
  async search(): Promise<PaletteResult[]> {
    return [];
  },
  onSelect() {},
};

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
      data: { action: cmd.action },
    }));
  },
  onSelect(result: PaletteResult) {
    const data = result.data as { action: () => void };
    data.action();
  },
};

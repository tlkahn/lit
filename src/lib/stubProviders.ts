import type { PaletteProvider } from "./paletteRegistry";

export const fileProvider: PaletteProvider = {
  id: "files",
  prefix: "$",
  label: "Files",
  priority: 10,
  async search() {
    return [];
  },
  onSelect() {},
};

export const tagProvider: PaletteProvider = {
  id: "tags",
  prefix: "#",
  label: "Tags",
  priority: 30,
  async search() {
    return [];
  },
  onSelect() {},
};

export const contentProvider: PaletteProvider = {
  id: "content",
  prefix: "/",
  label: "Content",
  priority: 40,
  async search() {
    return [];
  },
  onSelect() {},
};

export const commandProvider: PaletteProvider = {
  id: "commands",
  prefix: "!",
  label: "Commands",
  priority: 50,
  async search() {
    return [];
  },
  onSelect() {},
};

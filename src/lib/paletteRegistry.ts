export interface PaletteResult {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  shortcut?: string;
  section: string;
  data?: unknown;
}

export interface PaletteFilterOption {
  id: string;
  label: string;
  icon?: string;
}

export interface PaletteProvider {
  id: string;
  prefix?: string;
  label: string;
  priority: number;
  filterOptions?: PaletteFilterOption[];
  search(query: string, filter?: string): Promise<PaletteResult[]>;
  onSelect(result: PaletteResult): void;
}

const providers = new Map<string, PaletteProvider>();

export const paletteRegistry = {
  register(provider: PaletteProvider): void {
    providers.set(provider.id, provider);
  },

  getAll(): PaletteProvider[] {
    return Array.from(providers.values()).sort((a, b) => a.priority - b.priority);
  },

  getByPrefix(prefix: string): PaletteProvider | undefined {
    for (const p of providers.values()) {
      if (p.prefix === prefix) return p;
    }
    return undefined;
  },

  _clear(): void {
    providers.clear();
  },
};

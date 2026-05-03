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

export function register(provider: PaletteProvider): void {
  providers.set(provider.id, provider);
}

export function getAll(): PaletteProvider[] {
  return [...providers.values()].sort((a, b) => a.priority - b.priority);
}

export function getByPrefix(prefix: string): PaletteProvider | undefined {
  for (const p of providers.values()) {
    if (p.prefix === prefix) return p;
  }
  return undefined;
}

export function _clear(): void {
  providers.clear();
}

const cache = new Map<string, string>();
let lastTheme: string | null = null;
let nextId = 0;

export async function renderMermaid(
  source: string,
  theme: "default" | "dark",
): Promise<string> {
  const key = `${theme}::${source}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const mermaid = (await import("mermaid")).default;

  if (lastTheme !== theme) {
    mermaid.initialize({ startOnLoad: false, theme });
    lastTheme = theme;
  }

  const id = `mermaid-${nextId++}`;
  const { svg } = await mermaid.render(id, source);
  cache.set(key, svg);
  return svg;
}

export function getMermaidCached(
  source: string,
  theme: "default" | "dark",
): string | undefined {
  return cache.get(`${theme}::${source}`);
}

export function clearMermaidCache(): void {
  cache.clear();
  lastTheme = null;
}

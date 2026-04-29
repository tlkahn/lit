import type katexType from "katex";

let katexModule: typeof katexType | null = null;
let loadPromise: Promise<typeof katexType> | null = null;

export function loadKatex(): Promise<typeof katexType> {
  if (katexModule) return Promise.resolve(katexModule);
  if (!loadPromise) {
    loadPromise = import("katex").then((m) => {
      katexModule = m.default;
      return m.default;
    });
  }
  return loadPromise;
}

export function getKatexSync(): typeof katexType | null {
  return katexModule;
}

export function resetKatexLoader(): void {
  katexModule = null;
  loadPromise = null;
}

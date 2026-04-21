import type { PageMeta } from "./ipc";

export function getNextUntitledName(pages: PageMeta[]): string {
  const titles = new Set(pages.map((p) => p.title));
  if (!titles.has("Untitled")) return "Untitled";
  let n = 1;
  while (titles.has(`Untitled ${n}`)) n++;
  return `Untitled ${n}`;
}

import type { BibEntry } from "./ipc";

export type SectionedItem =
  | { kind: "header"; letter: string }
  | { kind: "entry"; entry: BibEntry };

export function lastName(entry: BibEntry): string {
  const first = entry.authors[0] ?? "";
  const comma = first.indexOf(",");
  const name = comma >= 0 ? first.slice(0, comma).trim() : first.trim();
  return name || first;
}

export function initialOf(entry: BibEntry): string {
  const name = lastName(entry);
  if (!name) return "#";
  const ch = name.normalize("NFD").charAt(0).toUpperCase();
  return /^[A-Z]$/.test(ch) ? ch : "#";
}

export function buildSectionedList(filtered: BibEntry[]): {
  items: SectionedItem[];
  letterSet: Set<string>;
} {
  const items: SectionedItem[] = [];
  const letterSet = new Set<string>();
  let currentLetter: string | null = null;

  for (const entry of filtered) {
    const letter = initialOf(entry);
    if (letter !== currentLetter) {
      items.push({ kind: "header", letter });
      currentLetter = letter;
      letterSet.add(letter);
    }
    items.push({ kind: "entry", entry });
  }

  return { items, letterSet };
}

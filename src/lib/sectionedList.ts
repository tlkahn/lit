import type { BibEntry } from "./ipc";

export type SectionedItem =
  | { kind: "header"; letter: string }
  | { kind: "entry"; entry: BibEntry };

/** Non-decomposable Latin-script letters that NFD does not split into base + combining mark. */
const NON_DECOMPOSABLE_LATIN: Record<string, string> = {
  Ð: "D", Þ: "T", Ł: "L", Ø: "O", Đ: "D", Ħ: "H", Ŋ: "N", Ŧ: "T",
  Ɓ: "B", Ƈ: "C", Ɖ: "D", Ɗ: "D", Ə: "E", Ɛ: "E", Ƒ: "F", Ɠ: "G",
  Ɣ: "G", Ɩ: "I", Ɨ: "I", Ƙ: "K", Ɯ: "M", Ɲ: "N", Ɵ: "O", Ƥ: "P",
  Ʀ: "R", Ʃ: "S", Ƭ: "T", Ʈ: "T", Ʊ: "U", Ʋ: "V", Ƴ: "Y", Ʒ: "Z",
};

export function lastName(entry: BibEntry): string {
  const first = entry.authors[0] ?? "";
  const comma = first.indexOf(",");
  const name = comma >= 0 ? first.slice(0, comma).trim() : first.trim();
  return name || first;
}

export function initialOf(entry: BibEntry): string {
  const name = lastName(entry);
  if (!name) return "#";
  const raw = name.charAt(0).toUpperCase();
  const ch = raw.normalize("NFD").charAt(0).toUpperCase();
  if (/^[A-Z]$/.test(ch)) return ch;
  return NON_DECOMPOSABLE_LATIN[raw] ?? "#";
}

export function buildSectionedList(filtered: BibEntry[]): {
  items: SectionedItem[];
  letterSet: Set<string>;
  letterToIndex: Map<string, number>;
} {
  const items: SectionedItem[] = [];
  const letterSet = new Set<string>();
  const letterToIndex = new Map<string, number>();
  let currentLetter: string | null = null;

  for (const entry of filtered) {
    const letter = initialOf(entry);
    if (letter !== currentLetter) {
      items.push({ kind: "header", letter });
      letterToIndex.set(letter, items.length - 1);
      currentLetter = letter;
      letterSet.add(letter);
    }
    items.push({ kind: "entry", entry });
  }

  return { items, letterSet, letterToIndex };
}

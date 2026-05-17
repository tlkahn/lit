import { parseKeyString } from "./keyChordFormat";

const CANONICAL_MODIFIER_ORDER = ["Ctrl", "Mod", "Shift", "Alt"];

function normalizeChord(chord: string): string {
  const { modifiers, key } = parseKeyString(chord);
  const sorted = [...modifiers].sort(
    (a, b) => CANONICAL_MODIFIER_ORDER.indexOf(a) - CANONICAL_MODIFIER_ORDER.indexOf(b),
  );
  const normalizedKey = key.length === 1 ? key.toLowerCase() : key;
  if (sorted.length === 0) return normalizedKey;
  return sorted.join("-") + "-" + normalizedKey;
}

export function normalizeKeyNotation(notation: string): string {
  return notation.split(" ").map(normalizeChord).join(" ");
}

export function keysEqual(a: string, b: string): boolean {
  return normalizeKeyNotation(a) === normalizeKeyNotation(b);
}

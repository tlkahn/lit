export interface ParsedKey {
  modifiers: string[];
  key: string;
}

const KNOWN_MODIFIERS = new Set(["Mod", "Ctrl", "Shift", "Alt"]);

export function parseKeyString(keyString: string): ParsedKey {
  const modifiers: string[] = [];
  let remaining = keyString;

  while (true) {
    const dashIdx = remaining.indexOf("-");
    if (dashIdx === -1) break;
    const prefix = remaining.slice(0, dashIdx);
    if (KNOWN_MODIFIERS.has(prefix)) {
      modifiers.push(prefix);
      remaining = remaining.slice(dashIdx + 1);
    } else {
      break;
    }
  }

  return { modifiers, key: remaining };
}

const MAC_SYMBOLS: Record<string, string> = {
  Mod: "⌘",
  Shift: "⇧",
  Alt: "⌥",
  Ctrl: "⌃",
};

const OTHER_LABELS: Record<string, string> = {
  Mod: "Ctrl",
  Shift: "Shift",
  Alt: "Alt",
  Ctrl: "Ctrl",
};

export type Platform = "mac" | "other";

export function formatKeyForDisplay(parsed: ParsedKey, platform: Platform): string {
  const displayKey = parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key;

  if (platform === "mac") {
    const mods = parsed.modifiers.map((m) => MAC_SYMBOLS[m] ?? m).join("");
    return mods + displayKey;
  }

  const mods = parsed.modifiers.map((m) => OTHER_LABELS[m] ?? m);
  const parts = [...mods, displayKey];
  return parts.join("+");
}

export function formatChordSequence(chordString: string, platform: Platform): string {
  if (chordString === "") return "";
  const chords = chordString.split(" ");
  return chords
    .map((chord) => formatKeyForDisplay(parseKeyString(chord), platform))
    .join(" ");
}

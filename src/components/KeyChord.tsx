import { parseKeyString, type Platform } from "../lib/keyChordFormat";

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

function detectPlatform(): Platform {
  return navigator.platform?.startsWith("Mac") ? "mac" : "other";
}

interface KeyChordProps {
  chord: string;
  platform?: Platform;
}

export function KeyChord({ chord, platform }: KeyChordProps) {
  const p = platform ?? detectPlatform();

  if (!chord) {
    return (
      <span data-testid="key-chord" className="text-text-muted">
        —
      </span>
    );
  }

  const chords = chord.split(" ");

  return (
    <span data-testid="key-chord" className="inline-flex items-center gap-0.5">
      {chords.map((chordStr, ci) => {
        const parsed = parseKeyString(chordStr);
        const symbols = p === "mac"
          ? [...parsed.modifiers.map((m) => MAC_SYMBOLS[m] ?? m), parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key]
          : [...parsed.modifiers.map((m) => OTHER_LABELS[m] ?? m), parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key];

        return (
          <span key={ci} className={ci > 0 ? "ml-1" : undefined}>
            {symbols.map((sym, si) => (
              <kbd
                key={si}
                className="rounded bg-bg-secondary border border-border px-1 text-xs font-mono"
              >
                {sym}
              </kbd>
            ))}
          </span>
        );
      })}
    </span>
  );
}

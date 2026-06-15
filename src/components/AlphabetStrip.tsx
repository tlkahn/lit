import { useState, useRef, useCallback } from "react";

const ALPHABET = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
  "#",
];

interface AlphabetStripProps {
  letterSet: Set<string>;
  activeLetter: string;
  onLetterClick: (letter: string) => void;
  onLetterDrag?: (letter: string) => void;
  visible?: boolean;
}

function nearestAvailable(index: number, letterSet: Set<string>): string | null {
  for (let d = 0; d < ALPHABET.length; d++) {
    if (index - d >= 0 && letterSet.has(ALPHABET[index - d]!)) return ALPHABET[index - d]!;
    if (index + d < ALPHABET.length && letterSet.has(ALPHABET[index + d]!)) return ALPHABET[index + d]!;
  }
  return null;
}

export function AlphabetStrip({
  letterSet,
  activeLetter,
  onLetterClick,
  onLetterDrag,
  visible = true,
}: AlphabetStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragState, setDragState] = useState<{ letter: string; y: number } | null>(null);
  const lastDragLetterRef = useRef<string | null>(null);
  const didDragRef = useRef(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const letterFromY = useCallback((clientY: number): { letter: string; relY: number } | null => {
    const el = stripRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const relativeY = clientY - rect.top;
    const index = Math.floor(relativeY / (rect.height / ALPHABET.length));
    const clamped = Math.max(0, Math.min(ALPHABET.length - 1, index));
    return { letter: ALPHABET[clamped]!, relY: relativeY };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    didDragRef.current = false;
    lastDragLetterRef.current = null;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    didDragRef.current = true;
    const result = letterFromY(e.clientY);
    if (!result) return;

    const { letter, relY } = result;
    const idx = ALPHABET.indexOf(letter);
    const target = nearestAvailable(idx, letterSet);
    setDragState({ letter: target ?? letter, y: relY });

    if (target && target !== lastDragLetterRef.current) {
      lastDragLetterRef.current = target;
      (onLetterDrag ?? onLetterClick)(target);
    }
  }, [letterFromY, letterSet, onLetterDrag, onLetterClick]);

  const handlePointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    draggingRef.current = false;
    setDragState(null);
    lastDragLetterRef.current = null;
  }, []);

  const handleButtonClick = useCallback((letter: string) => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    onLetterClick(letter);
  }, [onLetterClick]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => {
        const next = e.key === "ArrowDown"
          ? Math.min(prev + 1, ALPHABET.length - 1)
          : Math.max(prev - 1, 0);
        return next;
      });
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setFocusedIndex((current) => {
        const letter = ALPHABET[current];
        if (letter && letterSet.has(letter)) onLetterClick(letter);
        return current;
      });
    }
  }, [letterSet, onLetterClick]);

  if (!visible) return null;

  return (
    <nav
      ref={stripRef}
      data-testid="alphabet-strip"
      role="navigation"
      aria-label="Alphabetical index"
      tabIndex={0}
      className="absolute right-0 top-1/2 z-10 flex w-4 -translate-y-1/2 touch-none flex-col items-center outline-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
      onFocus={() => { if (focusedIndex < 0) setFocusedIndex(0); }}
    >
      {ALPHABET.map((letter, i) => {
        const available = letterSet.has(letter);
        const active = available && letter === activeLetter;
        const focused = i === focusedIndex;
        return (
          <button
            key={letter}
            data-testid="alphabet-letter"
            data-letter={letter}
            tabIndex={-1}
            disabled={!available}
            aria-label={`Jump to section ${letter}`}
            onClick={() => handleButtonClick(letter)}
            className={`px-0.5 py-[1px] text-[10px] leading-tight ${
              active
                ? "font-bold text-interactive-accent"
                : available
                  ? "text-text-muted"
                  : "opacity-30"
            }${focused ? " ring-1 ring-interactive-accent rounded-sm" : ""}`}
          >
            {letter}
          </button>
        );
      })}
      {dragState && (
        <div
          data-testid="alphabet-float-indicator"
          className="pointer-events-none absolute right-5 flex h-10 w-10 items-center justify-center rounded-full bg-interactive-accent text-lg font-bold text-white"
          style={{ top: Math.max(0, dragState.y - 20) }}
        >
          {dragState.letter}
        </div>
      )}
    </nav>
  );
}

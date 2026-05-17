import { useState, useCallback } from "react";
import type { Platform } from "../lib/keyChordFormat";
import { keyEventToNotation } from "../lib/keyEventToNotation";
import { KeyChord } from "./KeyChord";

type RecorderState = "idle" | "recording" | "captured";

export interface KeyRecorderProps {
  platform?: Platform;
  value?: string;
  onConfirm?: (notation: string) => void;
  onCancel?: () => void;
}

function hasModifiers(e: React.KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

export function KeyRecorder({ platform, value, onConfirm, onCancel }: KeyRecorderProps) {
  const [state, setState] = useState<RecorderState>("idle");
  const [captured, setCaptured] = useState<string | null>(null);

  const p: Platform = platform ?? (navigator.platform?.startsWith("Mac") ? "mac" : "other");

  const reset = useCallback(() => {
    setState("idle");
    setCaptured(null);
  }, []);

  const handleClick = useCallback(() => {
    if (state === "idle") {
      setState("recording");
    }
  }, [state]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (state === "recording") {
        e.preventDefault();

        if (e.key === "Escape" && !hasModifiers(e)) {
          reset();
          onCancel?.();
          return;
        }

        const notation = keyEventToNotation(e.nativeEvent, p);
        if (notation === null) return;

        if (notation === "Enter") return;

        setCaptured(notation);
        setState("captured");
      } else if (state === "captured") {
        e.preventDefault();

        if (e.key === "Escape" && !hasModifiers(e)) {
          reset();
          onCancel?.();
          return;
        }

        if (e.key === "Enter" && !hasModifiers(e)) {
          const result = captured;
          reset();
          if (result) onConfirm?.(result);
          return;
        }

        const notation = keyEventToNotation(e.nativeEvent, p);
        if (notation === null) return;
        setCaptured(notation);
      }
    },
    [state, captured, p, onConfirm, onCancel, reset],
  );

  const borderClass =
    state === "recording"
      ? "border-accent animate-pulse"
      : state === "captured"
        ? "border-accent"
        : "border-border";

  return (
    <div

      data-testid="key-recorder"
      data-state={state}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`inline-flex items-center justify-center rounded border px-2 py-1 min-w-[120px] cursor-pointer select-none focus:outline-none ${borderClass}`}
    >
      {state === "idle" && (
        value ? <KeyChord chord={value} platform={p} /> : <span className="text-text-muted">—</span>
      )}
      {state === "recording" && (
        <span className="text-text-muted text-sm">Press a key combination…</span>
      )}
      {state === "captured" && captured && (
        <KeyChord chord={captured} platform={p} />
      )}
    </div>
  );
}

import { useState, useCallback, useRef } from "react";
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
  const settledRef = useRef(false);

  const p: Platform = platform ?? (navigator.platform?.startsWith("Mac") ? "mac" : "other");

  const reset = useCallback(() => {
    setState("idle");
    setCaptured(null);
  }, []);

  const handleClick = useCallback(() => {
    if (state === "idle") {
      settledRef.current = false;
      setState("recording");
    }
  }, [state]);

  const handleBlur = useCallback(() => {
    if (settledRef.current) return;
    if (state === "captured" && captured) {
      settledRef.current = true;
      const result = captured;
      reset();
      onConfirm?.(result);
    } else if (state === "recording") {
      settledRef.current = true;
      reset();
      onCancel?.();
    }
  }, [state, captured, onConfirm, onCancel, reset]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (settledRef.current) return;
      if (state === "recording") {
        e.preventDefault();

        if (e.key === "Escape" && !hasModifiers(e)) {
          settledRef.current = true;
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
          settledRef.current = true;
          reset();
          onCancel?.();
          return;
        }

        if (e.key === "Enter" && !hasModifiers(e)) {
          settledRef.current = true;
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
      onBlur={handleBlur}
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

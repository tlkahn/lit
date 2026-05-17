import { keysEqual } from "./normalizeKeyNotation";
import type { KeyBinding } from "./ipc";

export function contextsOverlap(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const normA = a ?? null;
  const normB = b ?? null;
  if (normA === null || normB === null) return true;
  return normA === normB;
}

export function detectConflicts(
  newKey: string,
  newWhen: string | undefined | null,
  existingBindings: KeyBinding[],
  excludeCommand?: string,
): KeyBinding[] {
  return existingBindings.filter((b) => {
    if (excludeCommand && b.command === excludeCommand) return false;
    if (!keysEqual(newKey, b.key)) return false;
    return contextsOverlap(newWhen, b.when);
  });
}

export function applyRebind(
  allBindings: KeyBinding[],
  newKey: string,
  newCommand: string,
  newWhen: string | undefined,
  conflicting: KeyBinding,
): KeyBinding[] {
  const result = allBindings.filter((b) => {
    if (b.command === conflicting.command && b.key === conflicting.key) return false;
    if (b.command === newCommand && b.when === newWhen) return false;
    return true;
  });
  result.push({ command: newCommand, key: newKey, when: newWhen, source: "user" });
  return result;
}

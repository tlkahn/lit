import type { Platform } from "./keyChordFormat";

const MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "NumLock",
  "ScrollLock",
]);

export function keyEventToNotation(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  platform: Platform,
): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;

  const parts: string[] = [];

  if (platform === "mac") {
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.metaKey) parts.push("Mod");
  } else {
    if (event.ctrlKey) parts.push("Mod");
  }

  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  parts.push(key);

  return parts.join("-");
}

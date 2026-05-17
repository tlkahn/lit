import type { KeyBinding } from "./ipc";
import { keysEqual } from "./normalizeKeyNotation";

type SlotKey = string;

function slotKey(command: string, when: string | undefined): SlotKey {
  return `${command}\0${when ?? ""}`;
}

export function computeKeymapDiff(
  current: KeyBinding[],
  defaults: KeyBinding[],
): KeyBinding[] {
  const defaultSlots = new Map<SlotKey, KeyBinding>();
  for (const b of defaults) {
    defaultSlots.set(slotKey(b.command, b.when), b);
  }

  const currentSlots = new Map<SlotKey, KeyBinding>();
  for (const b of current) {
    currentSlots.set(slotKey(b.command, b.when), b);
  }

  const diff: KeyBinding[] = [];

  for (const [sk, binding] of currentSlots) {
    const defaultBinding = defaultSlots.get(sk);
    if (!defaultBinding) {
      const entry: KeyBinding = { command: binding.command, key: binding.key };
      if (binding.when) entry.when = binding.when;
      diff.push(entry);
    } else if (!keysEqual(binding.key, defaultBinding.key)) {
      const entry: KeyBinding = { command: binding.command, key: binding.key };
      if (binding.when) entry.when = binding.when;
      diff.push(entry);
    }
  }

  for (const [sk, defaultBinding] of defaultSlots) {
    if (!currentSlots.has(sk)) {
      const entry: KeyBinding = { command: defaultBinding.command, key: "" };
      if (defaultBinding.when) entry.when = defaultBinding.when;
      diff.push(entry);
    }
  }

  return diff;
}

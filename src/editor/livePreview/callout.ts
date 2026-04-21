import { StateEffect, StateField, type Transaction } from "@codemirror/state";

export interface CalloutInfo {
  type: string;
  resolvedType: string;
  fold: "collapsed" | "expanded" | null;
  title?: string;
}

const CALLOUT_RE = /^>\s*\[!(\w+)\]([+-])?\s*(.*)?$/;

const TYPE_ALIASES: Record<string, string> = {
  summary: "abstract",
  tldr: "abstract",
  check: "success",
  done: "success",
  hint: "tip",
  important: "tip",
  attention: "warning",
  caution: "warning",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote",
};

export function parseCalloutType(line: string): CalloutInfo | null {
  const m = CALLOUT_RE.exec(line);
  if (!m) return null;
  const rawType = m[1]!.toLowerCase();
  const foldChar = m[2] as "+" | "-" | undefined;
  const title = m[3]?.trim() || undefined;
  return {
    type: rawType,
    resolvedType: TYPE_ALIASES[rawType] ?? rawType,
    fold: foldChar === "-" ? "collapsed" : foldChar === "+" ? "expanded" : null,
    title,
  };
}

export const toggleCalloutEffect = StateEffect.define<{ pos: number }>();

export const calloutFoldField = StateField.define<Map<number, boolean>>({
  create() {
    return new Map();
  },
  update(value: Map<number, boolean>, tr: Transaction) {
    if (!tr.docChanged && !tr.effects.length) return value;
    const newMap = new Map<number, boolean>();
    for (const [pos, collapsed] of value) {
      const newPos = tr.changes.mapPos(pos, 1);
      newMap.set(newPos, collapsed);
    }
    for (const effect of tr.effects) {
      if (effect.is(toggleCalloutEffect)) {
        const current = newMap.get(effect.value.pos) ?? false;
        newMap.set(effect.value.pos, !current);
      }
    }
    return newMap;
  },
});

const CALLOUT_ICONS: Record<string, string> = {
  note: "✏",
  tip: "✨",
  warning: "⚠",
  danger: "⛔",
  info: "ℹ",
  success: "✔",
  failure: "✖",
  bug: "🐛",
  example: "☐",
  quote: "❝",
  question: "❓",
  abstract: "📄",
  todo: "☑",
};

export function getCalloutIcon(type: string): string {
  return CALLOUT_ICONS[type] ?? "ℹ";
}

export interface ConflictInfo {
  key: string;
  values: unknown[];
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted = Object.keys(obj).sort();
    return "{" + sorted.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function detectFrontmatterConflicts(
  sources: Record<string, unknown>[],
): Map<string, ConflictInfo> {
  const conflicts = new Map<string, ConflictInfo>();
  const valuesByKey = new Map<string, Set<string>>();
  const rawValuesByKey = new Map<string, unknown[]>();

  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      const serialized = stableStringify(value);
      if (!valuesByKey.has(key)) {
        valuesByKey.set(key, new Set());
        rawValuesByKey.set(key, []);
      }
      const existing = valuesByKey.get(key)!;
      if (!existing.has(serialized)) {
        existing.add(serialized);
        rawValuesByKey.get(key)!.push(value);
      }
    }
  }

  for (const [key, uniqueValues] of valuesByKey) {
    if (uniqueValues.size > 1) {
      conflicts.set(key, { key, values: rawValuesByKey.get(key)! });
    }
  }

  return conflicts;
}

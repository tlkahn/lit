export interface ConflictInfo {
  key: string;
  values: unknown[];
}

export function detectFrontmatterConflicts(
  sources: Record<string, unknown>[],
): Map<string, ConflictInfo> {
  const conflicts = new Map<string, ConflictInfo>();
  const valuesByKey = new Map<string, Set<string>>();
  const rawValuesByKey = new Map<string, unknown[]>();

  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      const serialized = JSON.stringify(value);
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

import type { CardboxAnnotation, GroupInfo } from "./ipc";

export type RenderEntry =
  | { kind: "card"; annotation: CardboxAnnotation }
  | { kind: "group"; groupId: string; info: GroupInfo; cards: CardboxAnnotation[] };

export function buildRenderEntries(
  order: string[],
  groups: Record<string, GroupInfo>,
  annotationMap: Map<string, CardboxAnnotation>,
  filteredUuidSet: Set<string>,
  filteredAnnotations: CardboxAnnotation[],
  pinned: string[],
): RenderEntry[] {
  const entries: RenderEntry[] = [];
  for (const entry of order) {
    if (entry.startsWith("group:")) {
      const gid = entry.slice(6);
      const group = groups[gid];
      if (!group) continue;
      const groupAnns = group.order
        .map((uuid) => annotationMap.get(uuid))
        .filter((a): a is CardboxAnnotation => a !== undefined && filteredUuidSet.has(a.uuid));
      if (groupAnns.length > 0) {
        entries.push({ kind: "group", groupId: gid, info: group, cards: groupAnns });
      }
    } else {
      const ann = annotationMap.get(entry);
      if (ann && filteredUuidSet.has(ann.uuid)) {
        entries.push({ kind: "card", annotation: ann });
      }
    }
  }

  const inOrder = new Set(
    order.flatMap((e) => {
      if (e.startsWith("group:")) {
        const g = groups[e.slice(6)];
        return g ? g.order : [];
      }
      return [e];
    }),
  );
  for (const ann of filteredAnnotations) {
    if (!inOrder.has(ann.uuid)) {
      entries.push({ kind: "card", annotation: ann });
    }
  }

  const pinnedSet = new Set(pinned);
  if (pinnedSet.size === 0) return entries;

  const pinnedEntries: RenderEntry[] = [];
  const rest: RenderEntry[] = [];
  const pinnedCardUuids = new Set<string>();
  for (const uuid of pinned) {
    const ann = annotationMap.get(uuid);
    if (ann && filteredUuidSet.has(ann.uuid)) {
      pinnedEntries.push({ kind: "card", annotation: ann });
      pinnedCardUuids.add(uuid);
    }
  }
  for (const entry of entries) {
    if (entry.kind === "card" && pinnedCardUuids.has(entry.annotation.uuid)) continue;
    rest.push(entry);
  }
  return [...pinnedEntries, ...rest];
}

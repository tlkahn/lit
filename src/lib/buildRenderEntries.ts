import { compareDocPosition, sortByDocPosition } from "./docOrder";
import type { CardboxAnnotation, GroupInfo } from "./ipc";

export type RenderEntry =
  | { kind: "card"; annotation: CardboxAnnotation }
  | { kind: "group"; groupId: string; info: GroupInfo; cards: CardboxAnnotation[] };

/**
 * Builds the cardbox render list in strict document order (#968).
 *
 * Groups render at the position of their earliest (filtered) member, with
 * members doc-ordered inside; ungrouped cards rank as themselves. Pinned
 * cards that survived filtering are hoisted to the top, doc-ordered among
 * themselves, and removed from the top-level card entries only - a pinned
 * group member still shows inside its group.
 */
export function buildRenderEntries(
  filteredAnnotations: CardboxAnnotation[],
  groups: Record<string, GroupInfo>,
  pinned: string[],
): RenderEntry[] {
  const filteredMap = new Map(filteredAnnotations.map((a) => [a.uuid, a]));

  const groupedUuids = new Set<string>();
  const groupEntries: { rank: CardboxAnnotation; entry: RenderEntry }[] = [];
  for (const [groupId, info] of Object.entries(groups)) {
    for (const uuid of info.order) groupedUuids.add(uuid);
    const cards = sortByDocPosition(
      info.order
        .map((uuid) => filteredMap.get(uuid))
        .filter((a): a is CardboxAnnotation => a !== undefined),
    );
    if (cards.length === 0) continue;
    groupEntries.push({ rank: cards[0]!, entry: { kind: "group", groupId, info, cards } });
  }

  const pinnedSet = new Set(pinned);
  const topCards = filteredAnnotations.filter(
    (a) => !groupedUuids.has(a.uuid) && !pinnedSet.has(a.uuid),
  );

  const ranked = [
    ...groupEntries,
    ...topCards.map((a) => ({ rank: a, entry: { kind: "card", annotation: a } as RenderEntry })),
  ].sort((x, y) => compareDocPosition(x.rank, y.rank));

  const hoisted: RenderEntry[] = sortByDocPosition(
    pinned
      .map((uuid) => filteredMap.get(uuid))
      .filter((a): a is CardboxAnnotation => a !== undefined),
  ).map((annotation) => ({ kind: "card", annotation }));

  return [...hoisted, ...ranked.map((r) => r.entry)];
}

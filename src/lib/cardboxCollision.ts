import { closestCenter, rectIntersection } from "@dnd-kit/core";
import type { CollisionDetection } from "@dnd-kit/core";

/**
 * Custom collision detection for the cardbox grid.
 *
 * Strategy:
 * 1. When dragging a group (group:xxx), only consider top-level slots (no group drop zones).
 * 2. When dragging a card, check group drop zones first (via rectIntersection).
 *    If the card overlaps a group drop zone, return that as the collision.
 * 3. Fall back to closestCenter for all other slots.
 */
export const cardboxCollisionDetection: CollisionDetection = (args) => {
  const activeId = String(args.active.id);
  const isGroupDrag = activeId.startsWith("group:");

  if (isGroupDrag) {
    // Groups can only be reordered at top level — filter out droppable zones and ingroup slots
    const topLevelOnly = args.droppableContainers.filter((c) => {
      const id = String(c.id);
      return !id.startsWith("droppable:") && !id.startsWith("ingroup:");
    });
    return closestCenter({ ...args, droppableContainers: topLevelOnly });
  }

  // Card drag: check group drop zones first
  const groupDropZones = args.droppableContainers.filter((c) =>
    String(c.id).startsWith("droppable:group:"),
  );

  if (groupDropZones.length > 0) {
    const intersections = rectIntersection({ ...args, droppableContainers: groupDropZones });
    if (intersections.length > 0) {
      return intersections;
    }
  }

  // Fall back to closestCenter for sortable items (ingroup + top-level)
  const sortableContainers = args.droppableContainers.filter((c) =>
    !String(c.id).startsWith("droppable:"),
  );
  return closestCenter({ ...args, droppableContainers: sortableContainers });
};

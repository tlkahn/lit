import { closestCenter, rectIntersection } from "@dnd-kit/core";
import type { CollisionDetection } from "@dnd-kit/core";

/**
 * Custom collision detection factory for the cardbox grid.
 *
 * @param sourceGroupId - the group that the actively-dragged card belongs to,
 *   or null when dragging a top-level card / group header.
 *
 * Strategy:
 * 1. When dragging a group (group:xxx), only consider top-level slots (no group drop zones).
 * 2. When dragging a card, check group drop zones first (via rectIntersection).
 *    - If the card originates from a group, that group's own droppable zone is
 *      excluded so that intra-group sortable targets (ingroup:gid:uuid) are
 *      reached via the closestCenter fallback.
 *    If the card overlaps a *different* group's drop zone, return that as the collision.
 * 3. Fall back to closestCenter for all other slots (ingroup + top-level sortables).
 */
export function makeCardboxCollision(sourceGroupId: string | null): CollisionDetection {
  return (args) => {
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

    // Card drag: check group drop zones first, but skip the card's own group
    const groupDropZones = args.droppableContainers.filter((c) => {
      const id = String(c.id);
      if (!id.startsWith("droppable:group:")) return false;
      // When dragging from inside a group, skip that group's drop zone so
      // closestCenter can pick up the ingroup: sortable targets instead.
      if (sourceGroupId && id === `droppable:group:${sourceGroupId}`) return false;
      return true;
    });

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
}

/** Default stateless collision detection (no source group context). */
export const cardboxCollisionDetection: CollisionDetection = makeCardboxCollision(null);

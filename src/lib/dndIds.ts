/**
 * DnD ID naming conventions for the cardbox grid.
 *
 * | ID format                     | Meaning                              |
 * |-------------------------------|--------------------------------------|
 * | `{uuid}`                      | Top-level card (bare UUID)           |
 * | `group:{gid}`                 | Group as sortable top-level entry    |
 * | `droppable:group:{gid}`       | Group's drop zone (accepts cards)    |
 * | `ingroup:{gid}:{uuid}`        | Card inside a specific group         |
 */

export type ParsedActiveId =
  | { type: "topCard"; uuid: string }
  | { type: "group"; groupId: string }
  | { type: "groupCard"; groupId: string; uuid: string };

export type ParsedOverId =
  | { type: "topCard"; uuid: string }
  | { type: "group"; groupId: string }
  | { type: "groupDropZone"; groupId: string }
  | { type: "groupCard"; groupId: string; uuid: string };

export function parseActiveId(id: string): ParsedActiveId {
  if (id.startsWith("ingroup:")) {
    const rest = id.slice("ingroup:".length);
    const sep = rest.indexOf(":");
    if (sep >= 0) {
      return { type: "groupCard", groupId: rest.slice(0, sep), uuid: rest.slice(sep + 1) };
    }
  }
  if (id.startsWith("group:")) {
    return { type: "group", groupId: id.slice("group:".length) };
  }
  return { type: "topCard", uuid: id };
}

export function parseOverId(id: string): ParsedOverId {
  if (id.startsWith("droppable:group:")) {
    return { type: "groupDropZone", groupId: id.slice("droppable:group:".length) };
  }
  if (id.startsWith("ingroup:")) {
    const rest = id.slice("ingroup:".length);
    const sep = rest.indexOf(":");
    if (sep >= 0) {
      return { type: "groupCard", groupId: rest.slice(0, sep), uuid: rest.slice(sep + 1) };
    }
  }
  if (id.startsWith("group:")) {
    return { type: "group", groupId: id.slice("group:".length) };
  }
  return { type: "topCard", uuid: id };
}

export function makeGroupCardId(groupId: string, uuid: string): string {
  return `ingroup:${groupId}:${uuid}`;
}

export function makeDroppableGroupId(groupId: string): string {
  return `droppable:group:${groupId}`;
}

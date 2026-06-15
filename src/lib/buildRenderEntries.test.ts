import { describe, it, expect } from "vitest";
import { buildRenderEntries } from "./buildRenderEntries";
import type { RenderEntry } from "./buildRenderEntries";
import type { CardboxAnnotation, GroupInfo } from "./ipc";

function makeAnn(uuid: string, type = "note"): CardboxAnnotation {
  return {
    uuid,
    annotation_type: type,
    certainty: "neutral",
    body: `body-${uuid}`,
    date: null,
    source_page_id: "p.md",
    source_page_title: "Page",
    source_line: 1,
    char_start: 0,
    char_end: 10,
    scope_kind: "words",
    scope_value: "1",
    original: null,
  };
}

function uuids(entries: RenderEntry[]): string[] {
  return entries.map((e) =>
    e.kind === "card" ? e.annotation.uuid : `group:${e.groupId}`,
  );
}

function setup(
  annIds: string[],
  order: string[],
  groups: Record<string, GroupInfo> = {},
  pinned: string[] = [],
) {
  const annotations = annIds.map((id) => makeAnn(id));
  const annotationMap = new Map(annotations.map((a) => [a.uuid, a]));
  const filteredUuidSet = new Set(annIds);
  return buildRenderEntries(
    order,
    groups,
    annotationMap,
    filteredUuidSet,
    annotations,
    pinned,
  );
}

describe("buildRenderEntries", () => {
  describe("pinned cards float to top", () => {
    it("pinned card appears before unpinned cards", () => {
      const result = setup(
        ["a", "b", "c"],
        ["a", "b", "c"],
        {},
        ["c"],
      );
      expect(uuids(result)).toEqual(["c", "a", "b"]);
    });

    it("multiple pinned cards appear in pinned-array order", () => {
      const result = setup(
        ["a", "b", "c", "d"],
        ["a", "b", "c", "d"],
        {},
        ["d", "b"],
      );
      expect(uuids(result)).toEqual(["d", "b", "a", "c"]);
    });

    it("pinned cards appear before groups", () => {
      const result = setup(
        ["a", "b", "c"],
        ["a", "group:g1", "c"],
        { g1: { name: "G1", order: ["b"], collapsed: false } },
        ["c"],
      );
      expect(uuids(result)).toEqual(["c", "a", "group:g1"]);
    });

    it("no pinned cards preserves original order", () => {
      const result = setup(
        ["a", "b", "c"],
        ["a", "b", "c"],
        {},
        [],
      );
      expect(uuids(result)).toEqual(["a", "b", "c"]);
    });

    it("pinned card that is filtered out does not appear", () => {
      const annotations = [makeAnn("a"), makeAnn("b"), makeAnn("c")];
      const annotationMap = new Map(annotations.map((a) => [a.uuid, a]));
      const filteredUuidSet = new Set(["a", "b"]);
      const filteredAnnotations = annotations.filter((a) => filteredUuidSet.has(a.uuid));
      const result = buildRenderEntries(
        ["a", "b", "c"],
        {},
        annotationMap,
        filteredUuidSet,
        filteredAnnotations,
        ["c", "a"],
      );
      expect(uuids(result)).toEqual(["a", "b"]);
    });

    it("pinned card inside a group still floats to top as individual card", () => {
      const result = setup(
        ["a", "b", "c"],
        ["group:g1", "c"],
        { g1: { name: "G1", order: ["a", "b"], collapsed: false } },
        ["b"],
      );
      // b is pinned and should appear at top as a card, ahead of the group
      const ids = uuids(result);
      expect(ids[0]).toBe("b");
      expect(ids).toContain("group:g1");
    });

    it("pinned order is respected, not insertion order", () => {
      const result = setup(
        ["x", "y", "z"],
        ["z", "y", "x"],
        {},
        ["y", "z"],
      );
      // pinned array says y first, then z
      expect(uuids(result)).toEqual(["y", "z", "x"]);
    });
  });

  describe("groups and cards interleave correctly", () => {
    it("groups appear at their order position", () => {
      const result = setup(
        ["a", "b", "c"],
        ["a", "group:g1", "c"],
        { g1: { name: "G1", order: ["b"], collapsed: false } },
        [],
      );
      expect(uuids(result)).toEqual(["a", "group:g1", "c"]);
      const groupEntry = result.find((e) => e.kind === "group");
      expect(groupEntry!.kind).toBe("group");
      if (groupEntry!.kind === "group") {
        expect(groupEntry!.cards.map((c) => c.uuid)).toEqual(["b"]);
      }
    });

    it("annotations not in order are appended at end", () => {
      const result = setup(
        ["a", "b", "c"],
        ["a"],
        {},
        [],
      );
      expect(uuids(result)).toEqual(["a", "b", "c"]);
    });
  });
});

import { describe, it, expect } from "vitest";
import { buildRenderEntries } from "./buildRenderEntries";
import type { RenderEntry } from "./buildRenderEntries";
import type { CardboxAnnotation, GroupInfo } from "./ipc";

function makeAnnotation(
  uuid: string,
  char_start: number,
  source_page_id = "a.md",
): CardboxAnnotation {
  return {
    uuid,
    annotation_type: "note",
    certainty: "neutral",
    body: `Body of ${uuid}`,
    date: null,
    source_page_id,
    source_page_title: "Doc",
    source_line: 1,
    char_start,
    char_end: char_start + 10,
    scope_kind: "words",
    scope_value: "1",
    original: null,
  };
}

function makeGroup(order: string[], collapsed = false): GroupInfo {
  return { name: "G", order, collapsed };
}

/** Flatten entries to a readable shape: card uuid or [groupId, memberUuids]. */
function shape(entries: RenderEntry[]): unknown[] {
  return entries.map((e) =>
    e.kind === "card"
      ? e.annotation.uuid
      : [e.groupId, e.cards.map((c) => c.uuid)],
  );
}

describe("buildRenderEntries (#968 document ordering)", () => {
  it("orders top-level cards by document position regardless of input order", () => {
    const a = makeAnnotation("a", 300);
    const b = makeAnnotation("b", 100);
    const c = makeAnnotation("c", 200);
    expect(shape(buildRenderEntries([a, b, c], {}, []))).toEqual(["b", "c", "a"]);
  });

  it("orders across pages by page id before char_start", () => {
    const a = makeAnnotation("a", 900, "a.md");
    const b = makeAnnotation("b", 5, "b.md");
    expect(shape(buildRenderEntries([b, a], {}, []))).toEqual(["a", "b"]);
  });

  it("ranks a group at its earliest member and interleaves with cards", () => {
    const top1 = makeAnnotation("top1", 10);
    const member1 = makeAnnotation("member1", 20);
    const top2 = makeAnnotation("top2", 30);
    const member2 = makeAnnotation("member2", 5);
    const groups = { g1: makeGroup(["member1", "member2"]) };
    expect(shape(buildRenderEntries([top1, member1, top2, member2], groups, []))).toEqual([
      ["g1", ["member2", "member1"]],
      "top1",
      "top2",
    ]);
  });

  it("orders within a group by document position, not GroupInfo.order", () => {
    const late = makeAnnotation("late", 500);
    const early = makeAnnotation("early", 10);
    const groups = { g1: makeGroup(["late", "early"]) };
    expect(shape(buildRenderEntries([late, early], groups, []))).toEqual([
      ["g1", ["early", "late"]],
    ]);
  });

  it("does not mutate GroupInfo.order", () => {
    const late = makeAnnotation("late", 500);
    const early = makeAnnotation("early", 10);
    const info = makeGroup(["late", "early"]);
    buildRenderEntries([late, early], { g1: info }, []);
    expect(info.order).toEqual(["late", "early"]);
  });

  it("drops filtered-out members and skips a fully filtered group", () => {
    const visible = makeAnnotation("visible", 10);
    const groups = {
      g1: makeGroup(["visible", "hidden"]),
      g2: makeGroup(["gone"]),
    };
    expect(shape(buildRenderEntries([visible], groups, []))).toEqual([
      ["g1", ["visible"]],
    ]);
  });

  it("hoists pinned cards to the top in document order, not pin order", () => {
    const a = makeAnnotation("a", 100);
    const b = makeAnnotation("b", 200);
    const c = makeAnnotation("c", 300);
    // Pinned late-first: document position must win over pin recency.
    expect(shape(buildRenderEntries([a, b, c], {}, ["c", "a"]))).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("keeps a pinned group member both hoisted and inside its group", () => {
    const member = makeAnnotation("member", 100);
    const top = makeAnnotation("top", 50);
    const groups = { g1: makeGroup(["member"]) };
    expect(shape(buildRenderEntries([member, top], groups, ["member"]))).toEqual([
      "member",
      "top",
      ["g1", ["member"]],
    ]);
  });

  it("ignores pinned uuids that are filtered out or unknown", () => {
    const a = makeAnnotation("a", 100);
    expect(shape(buildRenderEntries([a], {}, ["ghost", "a"]))).toEqual(["a"]);
  });

  it("returns an empty list for empty input", () => {
    expect(buildRenderEntries([], {}, [])).toEqual([]);
    expect(buildRenderEntries([], { g1: makeGroup(["x"]) }, ["x"])).toEqual([]);
  });
});

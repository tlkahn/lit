import { describe, it, expect } from "vitest";
import { compareDocPosition, sortByDocPosition } from "./docOrder";
import type { CardboxAnnotation } from "./ipc";

function makeAnnotation(
  uuid: string,
  source_page_id: string,
  char_start: number,
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

describe("docOrder", () => {
  it("orders annotations on the same page by char_start", () => {
    const late = makeAnnotation("late", "a.md", 500);
    const early = makeAnnotation("early", "a.md", 10);
    expect(sortByDocPosition([late, early]).map((a) => a.uuid)).toEqual(["early", "late"]);
    expect(compareDocPosition(early, late)).toBeLessThan(0);
    expect(compareDocPosition(late, early)).toBeGreaterThan(0);
  });

  it("orders across pages by source_page_id first, then char_start", () => {
    const bEarly = makeAnnotation("b-early", "b.md", 5);
    const aLate = makeAnnotation("a-late", "a.md", 900);
    expect(sortByDocPosition([bEarly, aLate]).map((a) => a.uuid)).toEqual(["a-late", "b-early"]);
  });

  it("breaks full ties by uuid", () => {
    const y = makeAnnotation("uuid-y", "a.md", 10);
    const x = makeAnnotation("uuid-x", "a.md", 10);
    expect(sortByDocPosition([y, x]).map((a) => a.uuid)).toEqual(["uuid-x", "uuid-y"]);
    expect(compareDocPosition(x, x)).toBe(0);
  });

  it("does not mutate its input", () => {
    const late = makeAnnotation("late", "a.md", 500);
    const early = makeAnnotation("early", "a.md", 10);
    const input = [late, early];
    sortByDocPosition(input);
    expect(input.map((a) => a.uuid)).toEqual(["late", "early"]);
  });
});

import { describe, it, expect } from "vitest";
import { detectFrontmatterConflicts } from "./frontmatterConflicts";

describe("detectFrontmatterConflicts", () => {
  it("returns empty map when values agree", () => {
    const sources = [
      { status: "draft" },
      { status: "draft" },
    ];
    const conflicts = detectFrontmatterConflicts(sources);
    expect(conflicts.size).toBe(0);
  });

  it("detects scalar conflict", () => {
    const sources = [
      { status: "draft" },
      { status: "done" },
    ];
    const conflicts = detectFrontmatterConflicts(sources);
    expect(conflicts.has("status")).toBe(true);
    expect(conflicts.get("status")!.values).toEqual(["draft", "done"]);
  });

  it("does not flag keys present in only one source", () => {
    const sources = [
      { status: "draft" },
      { author: "Bob" },
    ];
    const conflicts = detectFrontmatterConflicts(sources);
    expect(conflicts.size).toBe(0);
  });

  it("detects array value differences", () => {
    const sources = [
      { tags: ["a", "b"] },
      { tags: ["a", "c"] },
    ];
    const conflicts = detectFrontmatterConflicts(sources);
    expect(conflicts.has("tags")).toBe(true);
    expect(conflicts.get("tags")!.values).toHaveLength(2);
  });

  it("handles empty sources array", () => {
    const conflicts = detectFrontmatterConflicts([]);
    expect(conflicts.size).toBe(0);
  });

  it("handles three sources with partial overlap", () => {
    const sources = [
      { status: "draft", author: "Alice" },
      { status: "review", author: "Alice" },
      { status: "done", author: "Alice" },
    ];
    const conflicts = detectFrontmatterConflicts(sources);
    expect(conflicts.has("status")).toBe(true);
    expect(conflicts.get("status")!.values).toHaveLength(3);
    expect(conflicts.has("author")).toBe(false);
  });
});

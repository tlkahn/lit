import { describe, it, expect } from "vitest";
import type { FlatRow } from "../hooks/useFlatTree";
import type { PageMeta } from "./ipc";
import { resolveTrashTargets, visiblePagePaths, nextFocusIndex } from "./fileTreeTrash";

function makePage(title: string, path?: string): PageMeta {
  return {
    title,
    relative_path: path ?? `${title}.md`,
    frontmatter: {},
    created_at: 1000,
    modified_at: 1000,
    file_type: "markdown" as const,
    has_companion: false,
  };
}

function page(title: string, depth: number, path?: string): FlatRow {
  return {
    type: "page",
    key: path ?? `${title}.md`,
    depth,
    page: makePage(title, path),
  };
}

function folder(name: string, depth: number): FlatRow {
  return {
    type: "folder",
    key: `folder:${name}`,
    depth,
    folderName: name,
    folderPath: name,
    isCollapsed: false,
  };
}

describe("visiblePagePaths", () => {
  it("returns only page relative_paths in row order", () => {
    const rows: FlatRow[] = [
      folder("docs", 0),
      page("Alpha", 1, "docs/Alpha.md"),
      page("Beta", 1, "docs/Beta.md"),
      page("Root", 0, "Root.md"),
    ];
    expect(visiblePagePaths(rows)).toEqual(["docs/Alpha.md", "docs/Beta.md", "Root.md"]);
  });

  it("skips folders", () => {
    const rows: FlatRow[] = [
      folder("a", 0),
      folder("b", 1),
      page("Deep", 2, "a/b/Deep.md"),
    ];
    expect(visiblePagePaths(rows)).toEqual(["a/b/Deep.md"]);
  });

  it("returns empty for no pages", () => {
    expect(visiblePagePaths([folder("docs", 0)])).toEqual([]);
  });
});

describe("resolveTrashTargets", () => {
  const a = page("A", 0, "A.md");
  const b = page("B", 0, "B.md");
  const docs = folder("docs", 0);

  it("returns selected paths when selection non-empty even if focus is a folder", () => {
    const selected = new Set(["A.md", "B.md"]);
    expect(resolveTrashTargets(selected, docs)).toEqual(["A.md", "B.md"]);
  });

  it("returns focused page path when selection empty", () => {
    expect(resolveTrashTargets(new Set(), a)).toEqual(["A.md"]);
  });

  it("returns [] when selection empty and focus is a folder", () => {
    expect(resolveTrashTargets(new Set(), docs)).toEqual([]);
  });

  it("returns [] when selection empty and focus is null", () => {
    expect(resolveTrashTargets(new Set(), null)).toEqual([]);
  });

  it("orders selected paths by provided visible order", () => {
    const selected = new Set(["B.md", "A.md", "C.md"]);
    const order = ["A.md", "B.md", "C.md", "D.md"];
    expect(resolveTrashTargets(selected, b, order)).toEqual(["A.md", "B.md", "C.md"]);
  });
});

describe("nextFocusIndex", () => {
  const rows: FlatRow[] = [
    page("A", 0, "A.md"),
    page("B", 0, "B.md"),
    page("C", 0, "C.md"),
    page("D", 0, "D.md"),
  ];

  it("keeps focus when the focused row is not deleted", () => {
    expect(nextFocusIndex(rows, 1, new Set(["C.md"]))).toBe(1);
  });

  it("moves to the next surviving row when the focused page is deleted", () => {
    expect(nextFocusIndex(rows, 1, new Set(["B.md"]))).toBe(2);
  });

  it("moves to the previous row when the focused page is the last", () => {
    expect(nextFocusIndex(rows, 3, new Set(["D.md"]))).toBe(2);
  });

  it("skips other deleted rows when scanning", () => {
    expect(nextFocusIndex(rows, 0, new Set(["A.md", "B.md"]))).toBe(2);
  });

  it("moves to a folder row when it is the next neighbor", () => {
    const withFolder: FlatRow[] = [
      page("A", 0, "A.md"),
      page("B", 1, "docs/B.md"),
      folder("docs", 0),
      page("C", 0, "C.md"),
    ];
    expect(nextFocusIndex(withFolder, 1, new Set(["docs/B.md"]))).toBe(2);
  });

  it("returns -1 when every row is deleted", () => {
    const two = [page("A", 0, "A.md"), page("B", 0, "B.md")];
    expect(nextFocusIndex(two, 0, new Set(["A.md", "B.md"]))).toBe(-1);
  });
});

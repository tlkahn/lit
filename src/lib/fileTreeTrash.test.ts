import { describe, it, expect } from "vitest";
import type { FlatRow } from "../hooks/useFlatTree";
import type { PageMeta } from "./ipc";
import { resolveTrashTargets, visiblePagePaths, nextFocusKey } from "./fileTreeTrash";

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

describe("nextFocusKey", () => {
  const rows: FlatRow[] = [
    page("A", 0, "A.md"),
    page("B", 0, "B.md"),
    page("C", 0, "C.md"),
    page("D", 0, "D.md"),
  ];

  it("returns focused row key when that row survives", () => {
    expect(nextFocusKey(rows, 1, new Set(["C.md"]))).toBe("B.md");
  });

  it("returns next survivor key when focused page deleted", () => {
    expect(nextFocusKey(rows, 1, new Set(["B.md"]))).toBe("C.md");
  });

  it("returns previous survivor key when focused page was last", () => {
    expect(nextFocusKey(rows, 3, new Set(["D.md"]))).toBe("C.md");
  });

  it("skips other deleted rows when scanning forward", () => {
    expect(nextFocusKey(rows, 0, new Set(["A.md", "B.md"]))).toBe("C.md");
  });

  it("returns folder key when folder is next neighbor", () => {
    const withFolder: FlatRow[] = [
      page("A", 0, "A.md"),
      page("B", 1, "docs/B.md"),
      folder("docs", 0),
      page("C", 0, "C.md"),
    ];
    expect(nextFocusKey(withFolder, 1, new Set(["docs/B.md"]))).toBe("folder:docs");
  });

  it("returns null when every page deleted and no folder rows", () => {
    const two = [page("A", 0, "A.md"), page("B", 0, "B.md")];
    expect(nextFocusKey(two, 0, new Set(["A.md", "B.md"]))).toBeNull();
  });

  it("key remains resolvable after earlier rows are removed", () => {
    const rowsBefore: FlatRow[] = rows;
    const key = nextFocusKey(rowsBefore, 1, new Set(["A.md", "B.md"]));
    expect(key).toBe("C.md");
    const rowsAfter = [page("C", 0, "C.md"), page("D", 0, "D.md")];
    expect(rowsAfter.findIndex((r) => r.key === key)).toBe(0);
  });
});

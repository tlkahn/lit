import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFlatTree } from "./useFlatTree";
import type { FolderNode } from "./useFlatTree";

function makeRoot(
  pages: { title: string; relative_path: string }[] = [],
  children?: Map<string, FolderNode>,
): FolderNode {
  return {
    name: "",
    pages: pages.map((p) => ({
      ...p,
      frontmatter: {},
      created_at: null,
      modified_at: null,
      file_type: 'markdown' as const,
    })),
    children: children ?? new Map(),
  };
}

function makeFolder(
  name: string,
  pages: { title: string; relative_path: string }[] = [],
  children?: Map<string, FolderNode>,
): FolderNode {
  return {
    name,
    pages: pages.map((p) => ({
      ...p,
      frontmatter: {},
      created_at: null,
      modified_at: null,
      file_type: 'markdown' as const,
    })),
    children: children ?? new Map(),
  };
}

describe("useFlatTree", () => {
  it("empty root → empty array", () => {
    const root = makeRoot();
    const { result } = renderHook(() => useFlatTree(root));
    expect(result.current.rows).toEqual([]);
  });

  it("root-level pages → page rows with depth 0", () => {
    const root = makeRoot([
      { title: "Alpha", relative_path: "alpha.md" },
      { title: "Beta", relative_path: "beta.md" },
    ]);
    const { result } = renderHook(() => useFlatTree(root));
    expect(result.current.rows).toEqual([
      {
        type: "page",
        key: "alpha.md",
        depth: 0,
        page: expect.objectContaining({ title: "Alpha", relative_path: "alpha.md" }),
      },
      {
        type: "page",
        key: "beta.md",
        depth: 0,
        page: expect.objectContaining({ title: "Beta", relative_path: "beta.md" }),
      },
    ]);
  });

  it("single folder with pages → folder-header row + page rows", () => {
    const root = makeRoot(
      [],
      new Map([
        [
          "docs",
          makeFolder("docs", [
            { title: "Readme", relative_path: "docs/readme.md" },
          ]),
        ],
      ]),
    );
    const { result } = renderHook(() => useFlatTree(root));
    expect(result.current.rows).toEqual([
      {
        type: "folder",
        key: "folder:docs",
        depth: 0,
        folderName: "docs",
        folderPath: "docs",
        isCollapsed: false,
      },
      {
        type: "page",
        key: "docs/readme.md",
        depth: 1,
        page: expect.objectContaining({ title: "Readme", relative_path: "docs/readme.md" }),
      },
    ]);
  });

  it("collapsed folder → children hidden from output", () => {
    const root = makeRoot(
      [],
      new Map([
        [
          "docs",
          makeFolder("docs", [
            { title: "Readme", relative_path: "docs/readme.md" },
          ]),
        ],
      ]),
    );
    const { result } = renderHook(() => useFlatTree(root));

    act(() => result.current.toggleCollapse("docs"));

    expect(result.current.rows).toEqual([
      {
        type: "folder",
        key: "folder:docs",
        depth: 0,
        folderName: "docs",
        folderPath: "docs",
        isCollapsed: true,
      },
    ]);
  });

  it("nested folders → correct depth values", () => {
    const root = makeRoot(
      [],
      new Map([
        [
          "docs",
          makeFolder(
            "docs",
            [{ title: "Top", relative_path: "docs/top.md" }],
            new Map([
              [
                "api",
                makeFolder("api", [
                  { title: "Endpoints", relative_path: "docs/api/endpoints.md" },
                ]),
              ],
            ]),
          ),
        ],
      ]),
    );
    const { result } = renderHook(() => useFlatTree(root));
    const depths = result.current.rows.map((r) => [r.key, r.depth]);
    expect(depths).toEqual([
      ["folder:docs", 0],
      ["folder:docs/api", 1],
      ["docs/api/endpoints.md", 2],
      ["docs/top.md", 1],
    ]);
  });

  it("alphabetical folder sorting, pages after subfolders", () => {
    const root = makeRoot(
      [{ title: "Root Page", relative_path: "root.md" }],
      new Map([
        ["zebra", makeFolder("zebra")],
        ["alpha", makeFolder("alpha")],
      ]),
    );
    const { result } = renderHook(() => useFlatTree(root));
    const keys = result.current.rows.map((r) => r.key);
    expect(keys).toEqual(["folder:alpha", "folder:zebra", "root.md"]);
  });

  it('root name "" produces no folder-header row', () => {
    const root = makeRoot([
      { title: "Page", relative_path: "page.md" },
    ]);
    const { result } = renderHook(() => useFlatTree(root));
    const folderRows = result.current.rows.filter((r) => r.type === "folder");
    expect(folderRows).toEqual([]);
  });

  it("depth increments only for named folders", () => {
    const root = makeRoot(
      [],
      new Map([
        [
          "docs",
          makeFolder("docs", [
            { title: "Doc", relative_path: "docs/doc.md" },
          ]),
        ],
      ]),
    );
    const { result } = renderHook(() => useFlatTree(root));

    const docRow = result.current.rows.find((r) => r.key === "docs/doc.md");
    expect(docRow?.depth).toBe(1);

    const rootPages = makeRoot([
      { title: "Top", relative_path: "top.md" },
    ]);
    const { result: result2 } = renderHook(() => useFlatTree(rootPages));
    const topRow = result2.current.rows.find((r) => r.key === "top.md");
    expect(topRow?.depth).toBe(0);
  });
});

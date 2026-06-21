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
      has_companion: false,
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
      has_companion: false,
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

  it("single folder with pages → folder starts collapsed", () => {
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
        isCollapsed: true,
      },
    ]);
  });

  it("expanded folder → children visible in output", () => {
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

    act(() => result.current.toggleCollapse("docs"));
    act(() => result.current.toggleCollapse("docs/api"));

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

  it("without comparator, pages remain in insertion order", () => {
    const root = makeRoot([
      { title: "Banana", relative_path: "banana.md" },
      { title: "Apple", relative_path: "apple.md" },
    ]);
    const { result } = renderHook(() => useFlatTree(root));
    const titles = result.current.rows.map((r) =>
      r.type === "page" ? r.page.title : r.key,
    );
    expect(titles).toEqual(["Banana", "Apple"]);
  });

  it("with comparator, sorts pages within root folder", () => {
    const root = makeRoot([
      { title: "Banana", relative_path: "banana.md" },
      { title: "Apple", relative_path: "apple.md" },
    ]);
    const cmp = (a: { title: string }, b: { title: string }) =>
      a.title.localeCompare(b.title);
    const { result } = renderHook(() => useFlatTree(root, cmp));
    const titles = result.current.rows.map((r) =>
      r.type === "page" ? r.page.title : r.key,
    );
    expect(titles).toEqual(["Apple", "Banana"]);
  });

  it("with comparator, sorts pages within nested folders independently", () => {
    const root = makeRoot(
      [
        { title: "Z-root", relative_path: "z-root.md" },
        { title: "A-root", relative_path: "a-root.md" },
      ],
      new Map([
        [
          "docs",
          makeFolder("docs", [
            { title: "Z-doc", relative_path: "docs/z-doc.md" },
            { title: "A-doc", relative_path: "docs/a-doc.md" },
          ]),
        ],
      ]),
    );
    const cmp = (a: { title: string }, b: { title: string }) =>
      a.title.localeCompare(b.title);
    const { result } = renderHook(() => useFlatTree(root, cmp));

    act(() => result.current.toggleCollapse("docs"));

    const titles = result.current.rows
      .filter((r) => r.type === "page")
      .map((r) => (r as Extract<typeof r, { type: "page" }>).page.title);
    expect(titles).toEqual(["A-doc", "Z-doc", "A-root", "Z-root"]);
  });

  it("folders remain alphabetically sorted regardless of comparator", () => {
    const root = makeRoot(
      [],
      new Map([
        ["zebra", makeFolder("zebra")],
        ["alpha", makeFolder("alpha")],
      ]),
    );
    const cmp = (a: { title: string }, b: { title: string }) =>
      b.title.localeCompare(a.title);
    const { result } = renderHook(() => useFlatTree(root, cmp));
    const keys = result.current.rows.map((r) => r.key);
    expect(keys).toEqual(["folder:alpha", "folder:zebra"]);
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

    act(() => result.current.toggleCollapse("docs"));

    const docRow = result.current.rows.find((r) => r.key === "docs/doc.md");
    expect(docRow?.depth).toBe(1);

    const rootPages = makeRoot([
      { title: "Top", relative_path: "top.md" },
    ]);
    const { result: result2 } = renderHook(() => useFlatTree(rootPages));
    const topRow = result2.current.rows.find((r) => r.key === "top.md");
    expect(topRow?.depth).toBe(0);
  });

  describe("revealPath", () => {
    it("expands ancestor folders and returns correct row index", () => {
      const root = makeRoot(
        [],
        new Map([
          [
            "docs",
            makeFolder(
              "docs",
              [],
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

      // Initially folders are collapsed, only folder:docs visible
      expect(result.current.rows).toHaveLength(1);

      let rowIndex: number;
      act(() => {
        rowIndex = result.current.revealPath("docs/api/endpoints.md");
      });

      // After reveal, ancestors are expanded and we see all rows
      const rows = result.current.rows;
      expect(rows).toHaveLength(3); // folder:docs, folder:docs/api, endpoints.md

      // The folder rows should show isCollapsed: false
      const docsFolder = rows.find((r) => r.key === "folder:docs");
      expect(docsFolder?.type).toBe("folder");
      if (docsFolder?.type === "folder") {
        expect(docsFolder.isCollapsed).toBe(false);
      }

      const apiFolder = rows.find((r) => r.key === "folder:docs/api");
      expect(apiFolder?.type).toBe("folder");
      if (apiFolder?.type === "folder") {
        expect(apiFolder.isCollapsed).toBe(false);
      }

      // The returned index should point to the page row
      expect(rowIndex!).toBe(2); // folder:docs(0), folder:docs/api(1), endpoints.md(2)
      expect(rows[rowIndex!]?.key).toBe("docs/api/endpoints.md");
    });

    it("for root-level page returns correct index with no ancestor expansion", () => {
      const root = makeRoot([
        { title: "Alpha", relative_path: "alpha.md" },
        { title: "Beta", relative_path: "beta.md" },
      ]);
      const { result } = renderHook(() => useFlatTree(root));

      let rowIndex: number;
      act(() => {
        rowIndex = result.current.revealPath("alpha.md");
      });

      expect(rowIndex!).toBe(0);
      expect(result.current.rows[rowIndex!]?.key).toBe("alpha.md");

      act(() => {
        rowIndex = result.current.revealPath("beta.md");
      });

      expect(rowIndex!).toBe(1);
      expect(result.current.rows[rowIndex!]?.key).toBe("beta.md");
    });

    it("returns -1 for non-existent path", () => {
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

      let rowIndex: number;
      act(() => {
        rowIndex = result.current.revealPath("no/such/file.md");
      });

      expect(rowIndex!).toBe(-1);
    });

    it("returns correct index even when a prior toggleCollapse has not yet committed", () => {
      // Tree: alpha/ (with 2 pages), beta/ (with 1 page)
      // Scenario: expand alpha, then collapse alpha + reveal beta/page
      // in the same batch. The closure-captured `expanded` still has
      // alpha expanded, so the stale computation sees alpha's children
      // and produces a wrong (too-high) index for the beta page.
      const root = makeRoot(
        [],
        new Map([
          [
            "alpha",
            makeFolder("alpha", [
              { title: "A1", relative_path: "alpha/a1.md" },
              { title: "A2", relative_path: "alpha/a2.md" },
            ]),
          ],
          [
            "beta",
            makeFolder("beta", [
              { title: "B1", relative_path: "beta/b1.md" },
            ]),
          ],
        ]),
      );
      const { result } = renderHook(() => useFlatTree(root));

      // Expand alpha so its 2 pages are visible
      act(() => result.current.toggleCollapse("alpha"));
      // rows: folder:alpha(0), alpha/a1.md(1), alpha/a2.md(2), folder:beta(3)
      expect(result.current.rows).toHaveLength(4);

      let rowIndex: number;
      act(() => {
        // Collapse alpha — removes its 2 pages from the committed state
        result.current.toggleCollapse("alpha");
        // Immediately reveal beta/b1.md before React commits the collapse.
        // The closure-captured `expanded` still has alpha expanded.
        rowIndex = result.current.revealPath("beta/b1.md");
      });

      // After commit, rows should be:
      //   folder:alpha(0), folder:beta(1), beta/b1.md(2)
      // The returned index must match the COMMITTED row layout.
      expect(result.current.rows.map((r) => r.key)).toEqual([
        "folder:alpha",
        "folder:beta",
        "beta/b1.md",
      ]);
      expect(rowIndex!).toBe(2); // beta/b1.md is at index 2
      expect(result.current.rows[rowIndex!]?.key).toBe("beta/b1.md");
    });

    it("handles leading-slash path by normalizing to match tree keys", () => {
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

      // Initially only the collapsed folder is visible
      expect(result.current.rows).toHaveLength(1);

      let rowIndex: number;
      act(() => {
        // Pass a leading-slash path — should still match "docs/readme.md"
        rowIndex = result.current.revealPath("/docs/readme.md");
      });

      // The docs folder should be expanded
      const docsFolder = result.current.rows.find((r) => r.key === "folder:docs");
      expect(docsFolder?.type).toBe("folder");
      if (docsFolder?.type === "folder") {
        expect(docsFolder.isCollapsed).toBe(false);
      }

      // The returned index should point to the page row (not -1)
      expect(rowIndex!).toBe(1); // folder:docs(0), readme.md(1)
      expect(result.current.rows[rowIndex!]?.key).toBe("docs/readme.md");
    });

    it("is idempotent with already-expanded ancestors", () => {
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

      // Expand the folder first
      act(() => result.current.toggleCollapse("docs"));
      expect(result.current.rows).toHaveLength(2);

      // Now reveal a page inside the already-expanded folder
      let rowIndex: number;
      act(() => {
        rowIndex = result.current.revealPath("docs/readme.md");
      });

      expect(rowIndex!).toBe(1); // folder:docs(0), readme.md(1)
      expect(result.current.rows[rowIndex!]?.key).toBe("docs/readme.md");

      // Folder remains expanded
      const docsFolder = result.current.rows.find((r) => r.key === "folder:docs");
      if (docsFolder?.type === "folder") {
        expect(docsFolder.isCollapsed).toBe(false);
      }
    });
  });
});

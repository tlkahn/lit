import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { FlatRow } from "./useFlatTree";
import { useTreeKeyboard, findParentIndex } from "./useTreeKeyboard";
import type { PageMeta } from "../lib/ipc";

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

function folder(name: string, depth: number, collapsed = false): FlatRow {
  return {
    type: "folder",
    key: `folder:${name}`,
    depth,
    folderName: name,
    folderPath: name,
    isCollapsed: collapsed,
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

function fireKey(handler: (e: React.KeyboardEvent) => void, key: string) {
  const event = {
    key,
    preventDefault: vi.fn(),
  } as unknown as React.KeyboardEvent;
  handler(event);
  return event;
}

function setup(rows: FlatRow[]) {
  const toggleCollapse = vi.fn();
  const selectPage = vi.fn();
  const scrollToIndex = vi.fn();
  const { result, rerender } = renderHook(
    ({ rows: r }) =>
      useTreeKeyboard({
        rows: r,
        toggleCollapse,
        selectPage,
        scrollToIndex,
      }),
    { initialProps: { rows } },
  );
  return { result, rerender, toggleCollapse, selectPage, scrollToIndex };
}

describe("findParentIndex", () => {
  it("returns folder at depth-1 scanning backwards", () => {
    const rows: FlatRow[] = [folder("docs", 0), page("A", 1, "docs/A.md")];
    expect(findParentIndex(rows, 1)).toBe(0);
  });

  it("returns -1 for root-level items", () => {
    const rows: FlatRow[] = [page("A", 0)];
    expect(findParentIndex(rows, 0)).toBe(-1);
  });

  it("skips non-folder rows at matching depth", () => {
    const rows: FlatRow[] = [
      folder("docs", 0),
      page("sibling", 1, "docs/sibling.md"),
      page("target", 1, "docs/target.md"),
    ];
    expect(findParentIndex(rows, 2)).toBe(0);
  });

  it("finds nearest parent in nested structure", () => {
    const rows: FlatRow[] = [
      folder("a", 0),
      folder("b", 1),
      page("deep", 2, "a/b/deep.md"),
    ];
    expect(findParentIndex(rows, 2)).toBe(1);
  });
});

describe("useTreeKeyboard", () => {
  const sampleRows: FlatRow[] = [
    folder("docs", 0),
    page("Alpha", 1, "docs/Alpha.md"),
    page("Beta", 1, "docs/Beta.md"),
    page("Root", 0),
  ];

  it("starts with focusedIndex -1", () => {
    const { result } = setup(sampleRows);
    expect(result.current.focusedIndex).toBe(-1);
  });

  it("handleContainerFocus sets focusedIndex to 0 when -1", () => {
    const { result } = setup(sampleRows);
    act(() => result.current.handleContainerFocus());
    expect(result.current.focusedIndex).toBe(0);
  });

  it("handleContainerFocus is a no-op when already focused", () => {
    const { result } = setup(sampleRows);
    act(() => result.current.setFocusedIndex(2));
    act(() => result.current.handleContainerFocus());
    expect(result.current.focusedIndex).toBe(2);
  });

  it("ArrowDown moves focus forward", () => {
    const { result, scrollToIndex } = setup(sampleRows);
    act(() => result.current.setFocusedIndex(0));
    act(() => fireKey(result.current.handleKeyDown, "ArrowDown"));
    expect(result.current.focusedIndex).toBe(1);
    expect(scrollToIndex).toHaveBeenCalledWith(1);
  });

  it("ArrowUp moves focus backward", () => {
    const { result, scrollToIndex } = setup(sampleRows);
    act(() => result.current.setFocusedIndex(2));
    act(() => fireKey(result.current.handleKeyDown, "ArrowUp"));
    expect(result.current.focusedIndex).toBe(1);
    expect(scrollToIndex).toHaveBeenCalledWith(1);
  });

  it("ArrowDown clamps at last row", () => {
    const { result } = setup(sampleRows);
    act(() => result.current.setFocusedIndex(sampleRows.length - 1));
    act(() => fireKey(result.current.handleKeyDown, "ArrowDown"));
    expect(result.current.focusedIndex).toBe(sampleRows.length - 1);
  });

  it("ArrowUp clamps at first row", () => {
    const { result } = setup(sampleRows);
    act(() => result.current.setFocusedIndex(0));
    act(() => fireKey(result.current.handleKeyDown, "ArrowUp"));
    expect(result.current.focusedIndex).toBe(0);
  });

  it("Enter on page calls selectPage", () => {
    const { result, selectPage } = setup(sampleRows);
    act(() => result.current.setFocusedIndex(1));
    act(() => fireKey(result.current.handleKeyDown, "Enter"));
    expect(selectPage).toHaveBeenCalledWith("docs/Alpha.md");
  });

  it("Enter on folder calls toggleCollapse", () => {
    const { result, toggleCollapse } = setup(sampleRows);
    act(() => result.current.setFocusedIndex(0));
    act(() => fireKey(result.current.handleKeyDown, "Enter"));
    expect(toggleCollapse).toHaveBeenCalledWith("docs");
  });

  it("ArrowRight on collapsed folder expands it", () => {
    const rows: FlatRow[] = [folder("docs", 0, true), page("Root", 0)];
    const { result, toggleCollapse } = setup(rows);
    act(() => result.current.setFocusedIndex(0));
    act(() => fireKey(result.current.handleKeyDown, "ArrowRight"));
    expect(toggleCollapse).toHaveBeenCalledWith("docs");
    expect(result.current.focusedIndex).toBe(0);
  });

  it("ArrowRight on expanded folder moves to first child", () => {
    const { result, scrollToIndex } = setup(sampleRows);
    act(() => result.current.setFocusedIndex(0));
    act(() => fireKey(result.current.handleKeyDown, "ArrowRight"));
    expect(result.current.focusedIndex).toBe(1);
    expect(scrollToIndex).toHaveBeenCalledWith(1);
  });

  it("ArrowRight on page is a no-op", () => {
    const { result, scrollToIndex } = setup(sampleRows);
    scrollToIndex.mockClear();
    act(() => result.current.setFocusedIndex(1));
    scrollToIndex.mockClear();
    act(() => fireKey(result.current.handleKeyDown, "ArrowRight"));
    expect(result.current.focusedIndex).toBe(1);
  });

  it("ArrowLeft on expanded folder collapses it", () => {
    const { result, toggleCollapse } = setup(sampleRows);
    act(() => result.current.setFocusedIndex(0));
    act(() => fireKey(result.current.handleKeyDown, "ArrowLeft"));
    expect(toggleCollapse).toHaveBeenCalledWith("docs");
  });

  it("ArrowLeft on collapsed folder moves to parent", () => {
    const rows: FlatRow[] = [
      folder("a", 0),
      folder("b", 1, true),
      page("Root", 0),
    ];
    const { result } = setup(rows);
    act(() => result.current.setFocusedIndex(1));
    act(() => fireKey(result.current.handleKeyDown, "ArrowLeft"));
    expect(result.current.focusedIndex).toBe(0);
  });

  it("ArrowLeft on page moves to parent folder", () => {
    const { result } = setup(sampleRows);
    act(() => result.current.setFocusedIndex(1));
    act(() => fireKey(result.current.handleKeyDown, "ArrowLeft"));
    expect(result.current.focusedIndex).toBe(0);
  });

  it("ArrowLeft on root-level item is a no-op", () => {
    const { result } = setup(sampleRows);
    act(() => result.current.setFocusedIndex(3));
    act(() => fireKey(result.current.handleKeyDown, "ArrowLeft"));
    expect(result.current.focusedIndex).toBe(3);
  });

  it("Home jumps to first row", () => {
    const { result, scrollToIndex } = setup(sampleRows);
    act(() => result.current.setFocusedIndex(3));
    act(() => fireKey(result.current.handleKeyDown, "Home"));
    expect(result.current.focusedIndex).toBe(0);
    expect(scrollToIndex).toHaveBeenCalledWith(0);
  });

  it("End jumps to last row", () => {
    const { result, scrollToIndex } = setup(sampleRows);
    act(() => result.current.setFocusedIndex(0));
    act(() => fireKey(result.current.handleKeyDown, "End"));
    expect(result.current.focusedIndex).toBe(sampleRows.length - 1);
    expect(scrollToIndex).toHaveBeenCalledWith(sampleRows.length - 1);
  });

  it("clamps focusedIndex when rows shrink", () => {
    const { result, rerender } = setup(sampleRows);
    act(() => result.current.setFocusedIndex(3));
    const shorterRows = [page("Only", 0)];
    rerender({ rows: shorterRows });
    expect(result.current.focusedIndex).toBe(0);
  });

  it("keeps focusedIndex -1 when rows become empty", () => {
    const { result, rerender } = setup(sampleRows);
    rerender({ rows: [] });
    expect(result.current.focusedIndex).toBe(-1);
  });

  it("key handler calls preventDefault", () => {
    const { result } = setup(sampleRows);
    act(() => result.current.setFocusedIndex(0));
    let e: ReturnType<typeof fireKey>;
    act(() => {
      e = fireKey(result.current.handleKeyDown, "ArrowDown");
    });
    expect(e!.preventDefault).toHaveBeenCalled();
  });

  it("ArrowDown from -1 focuses first row", () => {
    const { result } = setup(sampleRows);
    expect(result.current.focusedIndex).toBe(-1);
    act(() => fireKey(result.current.handleKeyDown, "ArrowDown"));
    expect(result.current.focusedIndex).toBe(0);
  });

  it("ArrowUp from -1 focuses first row", () => {
    const { result } = setup(sampleRows);
    expect(result.current.focusedIndex).toBe(-1);
    act(() => fireKey(result.current.handleKeyDown, "ArrowUp"));
    expect(result.current.focusedIndex).toBe(0);
  });
});

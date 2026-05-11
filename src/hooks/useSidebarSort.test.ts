import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSidebarSort } from "./useSidebarSort";

beforeEach(() => {
  localStorage.clear();
});

describe("useSidebarSort", () => {
  it("defaults to title asc when no localStorage", () => {
    const { result } = renderHook(() => useSidebarSort("/workspace"));
    expect(result.current.sortConfig).toEqual({ key: "title", direction: "asc" });
  });

  it("reads stored config from localStorage", () => {
    localStorage.setItem(
      "lit-sidebar-sort:/workspace",
      JSON.stringify({ key: "modified_at", direction: "desc" }),
    );
    const { result } = renderHook(() => useSidebarSort("/workspace"));
    expect(result.current.sortConfig).toEqual({ key: "modified_at", direction: "desc" });
  });

  it("falls back to default on invalid JSON in localStorage", () => {
    localStorage.setItem("lit-sidebar-sort:/workspace", "not-json");
    const { result } = renderHook(() => useSidebarSort("/workspace"));
    expect(result.current.sortConfig).toEqual({ key: "title", direction: "asc" });
  });

  it("falls back to default on unknown sort key in localStorage", () => {
    localStorage.setItem(
      "lit-sidebar-sort:/workspace",
      JSON.stringify({ key: "unknown_field", direction: "asc" }),
    );
    const { result } = renderHook(() => useSidebarSort("/workspace"));
    expect(result.current.sortConfig).toEqual({ key: "title", direction: "asc" });
  });

  it("selecting a new key sets it with defaultDirectionFor and persists", () => {
    const { result } = renderHook(() => useSidebarSort("/workspace"));

    act(() => result.current.selectSortKey("modified_at"));

    expect(result.current.sortConfig).toEqual({ key: "modified_at", direction: "desc" });
    expect(JSON.parse(localStorage.getItem("lit-sidebar-sort:/workspace")!)).toEqual({
      key: "modified_at",
      direction: "desc",
    });
  });

  it("re-selecting the same key toggles direction", () => {
    const { result } = renderHook(() => useSidebarSort("/workspace"));

    act(() => result.current.selectSortKey("title"));
    expect(result.current.sortConfig).toEqual({ key: "title", direction: "desc" });

    act(() => result.current.selectSortKey("title"));
    expect(result.current.sortConfig).toEqual({ key: "title", direction: "asc" });
  });

  it("comparator matches current sortConfig", () => {
    const { result } = renderHook(() => useSidebarSort("/workspace"));
    const cmp = result.current.comparator;
    const a = { title: "A", relative_path: "a.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" as const };
    const b = { title: "B", relative_path: "b.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" as const };
    expect(cmp(a, b)).toBeLessThan(0);
  });

  it("changing workspacePath reads that workspace's stored config", () => {
    localStorage.setItem(
      "lit-sidebar-sort:/other",
      JSON.stringify({ key: "created_at", direction: "asc" }),
    );

    const { result, rerender } = renderHook(
      ({ path }) => useSidebarSort(path),
      { initialProps: { path: "/workspace" } },
    );
    expect(result.current.sortConfig).toEqual({ key: "title", direction: "asc" });

    rerender({ path: "/other" });
    expect(result.current.sortConfig).toEqual({ key: "created_at", direction: "asc" });
  });
});

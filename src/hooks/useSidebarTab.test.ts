import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSidebarTab } from "./useSidebarTab";

describe("useSidebarTab", () => {
  it("defaults to 'files' when no localStorage", () => {
    const { result } = renderHook(() => useSidebarTab());
    expect(result.current.tab).toBe("files");
  });

  it("reads stored tab from localStorage", () => {
    localStorage.setItem("lit-sidebar-tab", "outline");
    const { result } = renderHook(() => useSidebarTab());
    expect(result.current.tab).toBe("outline");
  });

  it("setTab('outline') switches and persists", () => {
    const { result } = renderHook(() => useSidebarTab());
    act(() => result.current.setTab("outline"));
    expect(result.current.tab).toBe("outline");
    expect(localStorage.getItem("lit-sidebar-tab")).toBe("outline");
  });

  it("invalid localStorage value falls back to 'files'", () => {
    localStorage.setItem("lit-sidebar-tab", "bogus");
    const { result } = renderHook(() => useSidebarTab());
    expect(result.current.tab).toBe("files");
  });
});

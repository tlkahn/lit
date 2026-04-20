import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSidebarPosition } from "./useSidebarPosition";

describe("useSidebarPosition", () => {
  it("defaults to left when no localStorage", () => {
    const { result } = renderHook(() => useSidebarPosition());
    expect(result.current.position).toBe("left");
  });

  it("reads stored position from localStorage", () => {
    localStorage.setItem("lit-sidebar-position", "right");
    const { result } = renderHook(() => useSidebarPosition());
    expect(result.current.position).toBe("right");
  });

  it("togglePosition switches left to right and persists", () => {
    const { result } = renderHook(() => useSidebarPosition());
    expect(result.current.position).toBe("left");

    act(() => result.current.togglePosition());
    expect(result.current.position).toBe("right");
    expect(localStorage.getItem("lit-sidebar-position")).toBe("right");

    act(() => result.current.togglePosition());
    expect(result.current.position).toBe("left");
    expect(localStorage.getItem("lit-sidebar-position")).toBe("left");
  });
});

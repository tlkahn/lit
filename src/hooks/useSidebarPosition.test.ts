import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSidebarPosition } from "./useSidebarPosition";
import { usePreferencesStore } from "../stores/preferences";

describe("useSidebarPosition", () => {
  beforeEach(() => {
    usePreferencesStore.setState({ darkMode: false, colorTheme: null, sidebarLocation: "left", loaded: true });
  });

  it("defaults to left", () => {
    const { result } = renderHook(() => useSidebarPosition());
    expect(result.current.position).toBe("left");
  });

  it("reads position from preferences store", () => {
    usePreferencesStore.setState({ sidebarLocation: "right" });
    const { result } = renderHook(() => useSidebarPosition());
    expect(result.current.position).toBe("right");
  });

  it("reacts to preferences store changes", () => {
    usePreferencesStore.setState({ sidebarLocation: "left" });
    const { result } = renderHook(() => useSidebarPosition());
    expect(result.current.position).toBe("left");

    act(() => usePreferencesStore.setState({ sidebarLocation: "right" }));
    expect(result.current.position).toBe("right");
  });
});

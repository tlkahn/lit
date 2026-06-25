import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBottomPanelPosition } from "./useBottomPanelPosition";
import { usePreferencesStore } from "../stores/preferences";
import { useResponsiveLayoutStore } from "../stores/responsiveLayout";

describe("useBottomPanelPosition", () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      sidebarLocation: "left",
      bottomPanelPosition: "bottom",
      loaded: true,
    });
    useResponsiveLayoutStore.setState({ bottomPanelForceBottom: false });
  });

  it("returns mode 'bottom' and effectiveSide 'right' by default", () => {
    const { result } = renderHook(() => useBottomPanelPosition());
    expect(result.current.mode).toBe("bottom");
    expect(result.current.effectiveSide).toBe("right");
  });

  it("returns effectiveSide 'left' when sidebar is on right", () => {
    usePreferencesStore.setState({ sidebarLocation: "right" });
    const { result } = renderHook(() => useBottomPanelPosition());
    expect(result.current.effectiveSide).toBe("left");
  });

  it("returns mode 'side' when preference is 'side'", () => {
    usePreferencesStore.setState({ bottomPanelPosition: "side" });
    const { result } = renderHook(() => useBottomPanelPosition());
    expect(result.current.mode).toBe("side");
  });

  // Exhaustive 4-combo coverage of (bottomPanelPosition, sidebarLocation)
  it.each([
    { position: "bottom" as const, sidebar: "left" as const, expectedMode: "bottom", expectedSide: "right" },
    { position: "bottom" as const, sidebar: "right" as const, expectedMode: "bottom", expectedSide: "left" },
    { position: "side" as const, sidebar: "left" as const, expectedMode: "side", expectedSide: "right" },
    { position: "side" as const, sidebar: "right" as const, expectedMode: "side", expectedSide: "left" },
  ])(
    "effectiveSide derivation: position=$position, sidebar=$sidebar -> mode=$expectedMode, side=$expectedSide",
    ({ position, sidebar, expectedMode, expectedSide }) => {
      usePreferencesStore.setState({ bottomPanelPosition: position, sidebarLocation: sidebar });
      const { result } = renderHook(() => useBottomPanelPosition());
      expect(result.current.mode).toBe(expectedMode);
      expect(result.current.effectiveSide).toBe(expectedSide);
    },
  );

  it("reacts to bottomPanelPosition changes", () => {
    const { result } = renderHook(() => useBottomPanelPosition());
    expect(result.current.mode).toBe("bottom");

    act(() => {
      usePreferencesStore.setState({ bottomPanelPosition: "side" });
    });

    expect(result.current.mode).toBe("side");
  });

  it("reacts to sidebarLocation changes", () => {
    const { result } = renderHook(() => useBottomPanelPosition());
    expect(result.current.effectiveSide).toBe("right");

    act(() => {
      usePreferencesStore.setState({ sidebarLocation: "right" });
    });

    expect(result.current.effectiveSide).toBe("left");
  });

  describe("responsive force-bottom override", () => {
    it("overrides 'side' to 'bottom' when forceBottom is true", () => {
      usePreferencesStore.setState({ bottomPanelPosition: "side" });
      useResponsiveLayoutStore.setState({ bottomPanelForceBottom: true });
      const { result } = renderHook(() => useBottomPanelPosition());
      expect(result.current.mode).toBe("bottom");
    });

    it("does not override 'bottom' preference when forceBottom is true", () => {
      usePreferencesStore.setState({ bottomPanelPosition: "bottom" });
      useResponsiveLayoutStore.setState({ bottomPanelForceBottom: true });
      const { result } = renderHook(() => useBottomPanelPosition());
      expect(result.current.mode).toBe("bottom");
    });

    it("returns 'side' when forceBottom is false", () => {
      usePreferencesStore.setState({ bottomPanelPosition: "side" });
      useResponsiveLayoutStore.setState({ bottomPanelForceBottom: false });
      const { result } = renderHook(() => useBottomPanelPosition());
      expect(result.current.mode).toBe("side");
    });

    it("reacts when forceBottom changes", () => {
      usePreferencesStore.setState({ bottomPanelPosition: "side" });
      const { result } = renderHook(() => useBottomPanelPosition());
      expect(result.current.mode).toBe("side");

      act(() => {
        useResponsiveLayoutStore.setState({ bottomPanelForceBottom: true });
      });

      expect(result.current.mode).toBe("bottom");

      act(() => {
        useResponsiveLayoutStore.setState({ bottomPanelForceBottom: false });
      });

      expect(result.current.mode).toBe("side");
    });
  });
});

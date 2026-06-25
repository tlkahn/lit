import { describe, it, expect, beforeEach } from "vitest";
import {
  useResponsiveLayoutStore,
  SIDEBAR_COLLAPSE_PX,
  PANE_COLLAPSE_PX,
  PANEL_FORCE_BOTTOM_PX,
  HYSTERESIS_PX,
} from "./responsiveLayout";

describe("responsiveLayout store", () => {
  beforeEach(() => {
    useResponsiveLayoutStore.setState({
      windowWidth: 1024,
      sidebarAutoCollapsed: false,
      panesCollapsed: false,
      bottomPanelForceBottom: false,
    });
  });

  it("starts with all responsive flags off at wide width", () => {
    const state = useResponsiveLayoutStore.getState();
    expect(state.sidebarAutoCollapsed).toBe(false);
    expect(state.panesCollapsed).toBe(false);
    expect(state.bottomPanelForceBottom).toBe(false);
  });

  describe("sidebar collapse", () => {
    it("collapses sidebar below threshold", () => {
      useResponsiveLayoutStore.getState().setWindowWidth(SIDEBAR_COLLAPSE_PX - 1);
      expect(useResponsiveLayoutStore.getState().sidebarAutoCollapsed).toBe(true);
    });

    it("does not collapse at exactly the threshold", () => {
      useResponsiveLayoutStore.getState().setWindowWidth(SIDEBAR_COLLAPSE_PX);
      expect(useResponsiveLayoutStore.getState().sidebarAutoCollapsed).toBe(false);
    });

    it("requires hysteresis to restore after collapse", () => {
      const { setWindowWidth } = useResponsiveLayoutStore.getState();
      setWindowWidth(SIDEBAR_COLLAPSE_PX - 1);
      expect(useResponsiveLayoutStore.getState().sidebarAutoCollapsed).toBe(true);

      setWindowWidth(SIDEBAR_COLLAPSE_PX);
      expect(useResponsiveLayoutStore.getState().sidebarAutoCollapsed).toBe(true);

      setWindowWidth(SIDEBAR_COLLAPSE_PX + HYSTERESIS_PX - 1);
      expect(useResponsiveLayoutStore.getState().sidebarAutoCollapsed).toBe(true);

      setWindowWidth(SIDEBAR_COLLAPSE_PX + HYSTERESIS_PX);
      expect(useResponsiveLayoutStore.getState().sidebarAutoCollapsed).toBe(false);
    });
  });

  describe("pane collapse", () => {
    it("collapses panes below threshold", () => {
      useResponsiveLayoutStore.getState().setWindowWidth(PANE_COLLAPSE_PX - 1);
      expect(useResponsiveLayoutStore.getState().panesCollapsed).toBe(true);
    });

    it("does not collapse at exactly the threshold", () => {
      useResponsiveLayoutStore.getState().setWindowWidth(PANE_COLLAPSE_PX);
      expect(useResponsiveLayoutStore.getState().panesCollapsed).toBe(false);
    });

    it("requires hysteresis to restore after collapse", () => {
      const { setWindowWidth } = useResponsiveLayoutStore.getState();
      setWindowWidth(PANE_COLLAPSE_PX - 1);
      expect(useResponsiveLayoutStore.getState().panesCollapsed).toBe(true);

      setWindowWidth(PANE_COLLAPSE_PX + HYSTERESIS_PX - 1);
      expect(useResponsiveLayoutStore.getState().panesCollapsed).toBe(true);

      setWindowWidth(PANE_COLLAPSE_PX + HYSTERESIS_PX);
      expect(useResponsiveLayoutStore.getState().panesCollapsed).toBe(false);
    });
  });

  describe("bottom panel force-bottom", () => {
    it("forces bottom below threshold", () => {
      useResponsiveLayoutStore.getState().setWindowWidth(PANEL_FORCE_BOTTOM_PX - 1);
      expect(useResponsiveLayoutStore.getState().bottomPanelForceBottom).toBe(true);
    });

    it("does not force at exactly the threshold", () => {
      useResponsiveLayoutStore.getState().setWindowWidth(PANEL_FORCE_BOTTOM_PX);
      expect(useResponsiveLayoutStore.getState().bottomPanelForceBottom).toBe(false);
    });

    it("requires hysteresis to restore after activation", () => {
      const { setWindowWidth } = useResponsiveLayoutStore.getState();
      setWindowWidth(PANEL_FORCE_BOTTOM_PX - 1);
      expect(useResponsiveLayoutStore.getState().bottomPanelForceBottom).toBe(true);

      setWindowWidth(PANEL_FORCE_BOTTOM_PX + HYSTERESIS_PX - 1);
      expect(useResponsiveLayoutStore.getState().bottomPanelForceBottom).toBe(true);

      setWindowWidth(PANEL_FORCE_BOTTOM_PX + HYSTERESIS_PX);
      expect(useResponsiveLayoutStore.getState().bottomPanelForceBottom).toBe(false);
    });
  });

  describe("combined breakpoints", () => {
    it("activates all flags at very narrow width", () => {
      useResponsiveLayoutStore.getState().setWindowWidth(400);
      const state = useResponsiveLayoutStore.getState();
      expect(state.sidebarAutoCollapsed).toBe(true);
      expect(state.panesCollapsed).toBe(true);
      expect(state.bottomPanelForceBottom).toBe(true);
    });

    it("activates only sidebar at medium width", () => {
      useResponsiveLayoutStore.getState().setWindowWidth(850);
      const state = useResponsiveLayoutStore.getState();
      expect(state.sidebarAutoCollapsed).toBe(true);
      expect(state.panesCollapsed).toBe(false);
      expect(state.bottomPanelForceBottom).toBe(false);
    });
  });
});

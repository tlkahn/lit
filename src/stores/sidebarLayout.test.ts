import { describe, it, expect, beforeEach } from "vitest";
import {
  useSidebarLayoutStore,
  DEFAULT_SIDEBAR_WIDTH_PX,
  MIN_SIDEBAR_WIDTH_PX,
  SIDEBAR_WIDTH_STORAGE_KEY,
  parseStoredSidebarWidth,
} from "./sidebarLayout";

beforeEach(() => {
  localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY);
  useSidebarLayoutStore.setState({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH_PX });
});

describe("sidebarLayout store", () => {
  it("sidebarWidth defaults to DEFAULT_SIDEBAR_WIDTH_PX when localStorage empty", () => {
    expect(useSidebarLayoutStore.getState().sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH_PX);
  });

  it("setSidebarWidth(400) updates state to 400", () => {
    useSidebarLayoutStore.getState().setSidebarWidth(400);
    expect(useSidebarLayoutStore.getState().sidebarWidth).toBe(400);
  });

  it("setSidebarWidth(400) writes '400' to lit-sidebar-width", () => {
    useSidebarLayoutStore.getState().setSidebarWidth(400);
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("400");
  });

  it("setSidebarWidth(50) clamps state and storage to MIN_SIDEBAR_WIDTH_PX", () => {
    useSidebarLayoutStore.getState().setSidebarWidth(50);
    expect(useSidebarLayoutStore.getState().sidebarWidth).toBe(MIN_SIDEBAR_WIDTH_PX);
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe(String(MIN_SIDEBAR_WIDTH_PX));
  });
});

describe("parseStoredSidebarWidth", () => {
  it("returns default when raw is null", () => {
    expect(parseStoredSidebarWidth(null)).toBe(DEFAULT_SIDEBAR_WIDTH_PX);
  });

  it("parses a valid number", () => {
    expect(parseStoredSidebarWidth("300")).toBe(300);
  });

  it("clamps on load to MIN_SIDEBAR_WIDTH_PX", () => {
    expect(parseStoredSidebarWidth("100")).toBe(MIN_SIDEBAR_WIDTH_PX);
  });

  it("returns default for invalid input", () => {
    expect(parseStoredSidebarWidth("abc")).toBe(DEFAULT_SIDEBAR_WIDTH_PX);
  });
});

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

  it("setSidebarWidth(300.4) rounds state and storage to 300", () => {
    useSidebarLayoutStore.getState().setSidebarWidth(300.4);
    expect(useSidebarLayoutStore.getState().sidebarWidth).toBe(300);
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("300");
  });

  it("setSidebarWidth(Infinity) leaves state unchanged and does not corrupt storage", () => {
    useSidebarLayoutStore.setState({ sidebarWidth: 240 });
    useSidebarLayoutStore.getState().setSidebarWidth(Infinity);
    expect(useSidebarLayoutStore.getState().sidebarWidth).toBe(240);
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).not.toBe("Infinity");
  });

  it("setSidebarWidth(NaN) leaves state unchanged", () => {
    useSidebarLayoutStore.setState({ sidebarWidth: 240 });
    useSidebarLayoutStore.getState().setSidebarWidth(NaN);
    expect(useSidebarLayoutStore.getState().sidebarWidth).toBe(240);
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

  it("returns default for 'Infinity'", () => {
    expect(parseStoredSidebarWidth("Infinity")).toBe(DEFAULT_SIDEBAR_WIDTH_PX);
  });

  it("returns default for '-Infinity'", () => {
    expect(parseStoredSidebarWidth("-Infinity")).toBe(DEFAULT_SIDEBAR_WIDTH_PX);
  });

  it("returns default for 'NaN'", () => {
    expect(parseStoredSidebarWidth("NaN")).toBe(DEFAULT_SIDEBAR_WIDTH_PX);
  });

  it("rounds fractional values to integer px", () => {
    expect(parseStoredSidebarWidth("300.6")).toBe(301);
  });
});

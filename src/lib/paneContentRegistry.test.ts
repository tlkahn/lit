import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerPaneContent,
  unregisterPaneContent,
  getPaneContent,
  updatePaneContent,
  subscribe,
  getSnapshot,
  _resetForTesting,
} from "./paneContentRegistry";

describe("paneContentRegistry", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("registerPaneContent stores entry, getPaneContent retrieves it", () => {
    const entry = { title: "Hello", frontmatter: { tags: ["a"] } };
    registerPaneContent("p1", entry);
    expect(getPaneContent("p1")).toEqual(entry);
  });

  it("unregisterPaneContent removes entry, returns null", () => {
    registerPaneContent("p1", { title: "Hello", frontmatter: {} });
    unregisterPaneContent("p1");
    expect(getPaneContent("p1")).toBeNull();
  });

  it("updatePaneContent merges partial updates", () => {
    registerPaneContent("p1", { title: "Old", frontmatter: { tags: ["a"] } });
    updatePaneContent("p1", { title: "New" });
    expect(getPaneContent("p1")).toEqual({
      title: "New",
      frontmatter: { tags: ["a"] },
    });
  });

  it("subscribe callback fires on register/update/unregister", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);

    registerPaneContent("p1", { title: "T", frontmatter: {} });
    expect(cb).toHaveBeenCalledTimes(1);

    updatePaneContent("p1", { title: "T2" });
    expect(cb).toHaveBeenCalledTimes(2);

    unregisterPaneContent("p1");
    expect(cb).toHaveBeenCalledTimes(3);

    unsub();
    registerPaneContent("p2", { title: "T3", frontmatter: {} });
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("getSnapshot returns incrementing version on each mutation", () => {
    const v0 = getSnapshot();
    registerPaneContent("p1", { title: "T", frontmatter: {} });
    const v1 = getSnapshot();
    updatePaneContent("p1", { title: "T2" });
    const v2 = getSnapshot();
    unregisterPaneContent("p1");
    const v3 = getSnapshot();

    expect(v1).toBeGreaterThan(v0);
    expect(v2).toBeGreaterThan(v1);
    expect(v3).toBeGreaterThan(v2);
  });

  it("getPaneContent returns null for unknown paneId", () => {
    expect(getPaneContent("nonexistent")).toBeNull();
  });
});

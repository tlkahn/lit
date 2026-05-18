import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  registerPaneContent,
  unregisterPaneContent,
  getPaneContent,
  updatePaneContent,
  subscribe,
  getSnapshot,
  usePaneField,
  _resetForTesting,
} from "./paneContentRegistry";
import type { PaneContentEntry } from "./paneContentRegistry";

describe("paneContentRegistry", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("registerPaneContent stores entry, getPaneContent retrieves it", () => {
    const entry = { title: "Hello", body: "# Hello", frontmatter: { tags: ["a"] } };
    registerPaneContent("p1", entry);
    expect(getPaneContent("p1")).toEqual(entry);
  });

  it("unregisterPaneContent removes entry, returns null", () => {
    registerPaneContent("p1", { title: "Hello", body: "", frontmatter: {} });
    unregisterPaneContent("p1");
    expect(getPaneContent("p1")).toBeNull();
  });

  it("updatePaneContent merges partial updates", () => {
    registerPaneContent("p1", { title: "Old", body: "old", frontmatter: { tags: ["a"] } });
    updatePaneContent("p1", { title: "New" });
    expect(getPaneContent("p1")).toEqual({
      title: "New",
      body: "old",
      frontmatter: { tags: ["a"] },
    });
  });

  it("subscribe callback fires on register/update/unregister", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);

    registerPaneContent("p1", { title: "T", body: "", frontmatter: {} });
    expect(cb).toHaveBeenCalledTimes(1);

    updatePaneContent("p1", { title: "T2" });
    expect(cb).toHaveBeenCalledTimes(2);

    unregisterPaneContent("p1");
    expect(cb).toHaveBeenCalledTimes(3);

    unsub();
    registerPaneContent("p2", { title: "T3", body: "", frontmatter: {} });
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("getSnapshot returns incrementing version on each mutation", () => {
    const v0 = getSnapshot();
    registerPaneContent("p1", { title: "T", body: "", frontmatter: {} });
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

  it("updatePaneContent returns true when paneId exists", () => {
    registerPaneContent("p1", { title: "T", body: "", frontmatter: {} });
    expect(updatePaneContent("p1", { title: "T2" })).toBe(true);
  });

  it("updatePaneContent returns false for unknown paneId", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    const vBefore = getSnapshot();

    expect(updatePaneContent("unknown", { title: "X" })).toBe(false);

    expect(cb).not.toHaveBeenCalled();
    expect(getSnapshot()).toBe(vBefore);
    unsub();
  });

  it("rawYaml round-trips through register/get and survives partial updates", () => {
    registerPaneContent("p1", {
      title: "T",
      body: "content",
      frontmatter: { tags: ["a"] },
      rawYaml: "tags:\n  - a\n",
    });
    expect(getPaneContent("p1")).toEqual({
      title: "T",
      body: "content",
      frontmatter: { tags: ["a"] },
      rawYaml: "tags:\n  - a\n",
    });

    updatePaneContent("p1", { title: "T2" });
    expect(getPaneContent("p1")!.rawYaml).toBe("tags:\n  - a\n");
  });

  it("updatePaneContent deep-merges frontmatter keys", () => {
    registerPaneContent("p1", {
      title: "T",
      body: "",
      frontmatter: { tags: ["a"], draft: true },
    });
    updatePaneContent("p1", { frontmatter: { tags: ["b"] } });
    expect(getPaneContent("p1")).toEqual({
      title: "T",
      body: "",
      frontmatter: { tags: ["b"], draft: true },
    });
  });

  it("body field in register/get/update", () => {
    registerPaneContent("p1", { title: "T", body: "initial body", frontmatter: {} });
    expect(getPaneContent("p1")!.body).toBe("initial body");

    updatePaneContent("p1", { body: "updated body" });
    expect(getPaneContent("p1")!.body).toBe("updated body");
    expect(getPaneContent("p1")!.title).toBe("T");
  });
});

describe("usePaneField", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("returns selected field from registry entry", () => {
    registerPaneContent("p1", { title: "Hello", body: "content", frontmatter: {} });
    const titleSel = (e: PaneContentEntry | null) => e?.title ?? "";
    const { result } = renderHook(() => usePaneField("p1", titleSel));
    expect(result.current).toBe("Hello");
  });

  it("returns default when paneId not registered", () => {
    const titleSel = (e: PaneContentEntry | null) => e?.title ?? "default";
    const { result } = renderHook(() => usePaneField("missing", titleSel));
    expect(result.current).toBe("default");
  });

  it("updates when selected field changes", () => {
    registerPaneContent("p1", { title: "Old", body: "", frontmatter: {} });
    const titleSel = (e: PaneContentEntry | null) => e?.title ?? "";
    const { result } = renderHook(() => usePaneField("p1", titleSel));
    expect(result.current).toBe("Old");

    act(() => {
      updatePaneContent("p1", { title: "New" });
    });
    expect(result.current).toBe("New");
  });

  it("gated selector does not re-render when body changes but selector returns constant", () => {
    registerPaneContent("p1", { title: "T", body: "initial", frontmatter: {} });
    const gatedSel = (e: PaneContentEntry | null) => e ? "stable" : "";
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount++;
      return usePaneField("p1", gatedSel);
    });
    expect(result.current).toBe("stable");
    const countAfterMount = renderCount;

    act(() => {
      updatePaneContent("p1", { body: "changed body" });
    });
    expect(renderCount).toBe(countAfterMount);
    expect(result.current).toBe("stable");
  });
});

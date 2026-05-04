import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockInvoke } from "../test/tauri-mock";

const { mockSelectPage, mockRecordJump, mockWorkspaceState } = vi.hoisted(() => {
  const mockSelectPage = vi.fn();
  const mockRecordJump = vi.fn();
  const mockWorkspaceState = {
    currentPagePath: "other.md" as string | null,
    selectPage: mockSelectPage,
  };
  return { mockSelectPage, mockRecordJump, mockWorkspaceState };
});

vi.mock("../stores/workspace", () => ({
  useWorkspaceStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector(mockWorkspaceState),
    {
      getState: () => mockWorkspaceState,
    },
  ),
}));

vi.mock("../editor/jumpTracker", () => ({
  globalJumpTracker: {
    recordJump: mockRecordJump,
  },
}));

import { tagProvider } from "./tagProvider";

describe("tagProvider", () => {
  beforeEach(() => {
    mockSelectPage.mockClear();
    mockRecordJump.mockClear();
    mockWorkspaceState.currentPagePath = "other.md";
  });

  describe("search — tag mode", () => {
    it("returns tag results with counts", async () => {
      mockInvoke((cmd) => {
        if (cmd === "search_tags")
          return [
            { tag: "rust", count: 5 },
            { tag: "rust-lang", count: 2 },
          ];
        return [];
      });
      const results = await tagProvider.search("rust");
      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe("tag:rust");
      expect(results[0]!.title).toBe("rust");
      expect(results[0]!.subtitle).toBe("5 pages");
      expect(results[0]!.section).toBe("Tags");
    });

    it("singular page count", async () => {
      mockInvoke((cmd) => {
        if (cmd === "search_tags") return [{ tag: "solo", count: 1 }];
        return [];
      });
      const results = await tagProvider.search("solo");
      expect(results[0]!.subtitle).toBe("1 page");
    });

    it("empty query returns empty", async () => {
      const results = await tagProvider.search("");
      expect(results).toHaveLength(0);
    });
  });

  describe("search — drill-down mode (: prefix)", () => {
    it("returns page results for tag", async () => {
      mockInvoke((cmd) => {
        if (cmd === "list_pages_by_tag")
          return [
            { id: "a.md", title: "Alpha", first_paragraph: "First para" },
          ];
        return [];
      });
      const results = await tagProvider.search(":rust");
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("a.md");
      expect(results[0]!.title).toBe("Alpha");
      expect(results[0]!.subtitle).toBe("First para");
    });

    it("empty tag after : returns empty", async () => {
      const results = await tagProvider.search(":");
      expect(results).toHaveLength(0);
    });
  });

  describe("onSelect — tag result", () => {
    it("dispatches lit:palette-set-input and returns false", () => {
      const dispatchSpy = vi.spyOn(window, "dispatchEvent");
      const result = tagProvider.onSelect({
        id: "tag:rust",
        title: "rust",
        subtitle: "5 pages",
        section: "Tags",
        data: { tag: "rust" },
      });
      expect(result).toBe(false);
      const event = dispatchSpy.mock.calls.find(
        (call) => (call[0] as CustomEvent).type === "lit:palette-set-input",
      );
      expect(event).toBeDefined();
      expect((event![0] as CustomEvent).detail).toEqual({ value: "#:rust" });
      dispatchSpy.mockRestore();
    });
  });

  describe("onSelect — page result", () => {
    it("calls selectPage and records jump", () => {
      tagProvider.onSelect({
        id: "a.md",
        title: "Alpha",
        section: "Tags",
        data: { path: "a.md" },
      });
      expect(mockRecordJump).toHaveBeenCalled();
      expect(mockSelectPage).toHaveBeenCalledWith("a.md");
    });

    it("does not navigate when selecting current page", () => {
      mockWorkspaceState.currentPagePath = "a.md";
      tagProvider.onSelect({
        id: "a.md",
        title: "Alpha",
        section: "Tags",
        data: { path: "a.md" },
      });
      expect(mockSelectPage).not.toHaveBeenCalled();
    });

    it("does not return false for page results", () => {
      const result = tagProvider.onSelect({
        id: "a.md",
        title: "Alpha",
        section: "Tags",
        data: { path: "a.md" },
      });
      expect(result).not.toBe(false);
    });
  });
});

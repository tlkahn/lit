import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  usePaneHistoryStore,
  initPaneHistoryTracking,
  stopPaneHistoryTracking,
  serializeHistory,
  deserializeHistory,
} from "./paneHistory";
import type { PaneHistoryStack } from "./paneHistory";
import { usePaneStore } from "./panes";
import { useWorkspaceStore } from "./workspace";

function resetStore() {
  usePaneHistoryStore.setState({ stacks: new Map() });
  usePaneStore.setState({
    root: { type: "leaf", id: "p1", pagePath: null },
    focusedPaneId: "p1",
  });
  // Reset workspace pages so the pageExists guard (empty => all valid) is active
  // by default. Tests that need specific pages call setWorkspacePages explicitly.
  useWorkspaceStore.setState({ pages: [] });
}

describe("paneHistory", () => {
  beforeEach(resetStore);

  describe("pushPage", () => {
    it("records a page in a new pane stack", () => {
      const { pushPage, canGoBack, canGoForward } = usePaneHistoryStore.getState();
      pushPage("p1", "a.md");
      expect(canGoBack("p1")).toBe(false);
      expect(canGoForward("p1")).toBe(false);
    });

    it("deduplicates consecutive identical pages", () => {
      const { pushPage } = usePaneHistoryStore.getState();
      pushPage("p1", "a.md");
      pushPage("p1", "a.md");
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["a.md"]);
    });

    it("allows the same page non-consecutively", () => {
      const { pushPage } = usePaneHistoryStore.getState();
      pushPage("p1", "a.md");
      pushPage("p1", "b.md");
      pushPage("p1", "a.md");
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["a.md", "b.md", "a.md"]);
    });

    it("truncates forward entries when mid-history", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");
      // Go back to b.md
      usePaneHistoryStore.getState().goBack("p1");
      // Push a new page — should truncate c.md
      usePaneHistoryStore.getState().pushPage("p1", "d.md");
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["a.md", "b.md", "d.md"]);
      expect(stack.index).toBe(2);
    });

    it("caps at MAX_ENTRIES (50)", () => {
      const { pushPage } = usePaneHistoryStore.getState();
      for (let i = 0; i < 60; i++) {
        pushPage("p1", `page-${i}.md`);
      }
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries.length).toBe(50);
      expect(stack.entries[0]).toBe("page-10.md");
      expect(stack.entries[49]).toBe("page-59.md");
    });
  });

  describe("goBack / goForward", () => {
    it("goBack returns the previous page", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");
      const target = usePaneHistoryStore.getState().goBack("p1");
      expect(target).toBe("b.md");
    });

    it("goForward returns the next page", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      usePaneHistoryStore.getState().goBack("p1");
      const target = usePaneHistoryStore.getState().goForward("p1");
      expect(target).toBe("b.md");
    });

    it("goBack returns null at the beginning", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      expect(usePaneHistoryStore.getState().goBack("p1")).toBeNull();
    });

    it("goForward returns null at the end", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      expect(usePaneHistoryStore.getState().goForward("p1")).toBeNull();
    });

    it("goBack/goForward return null for unknown pane", () => {
      expect(usePaneHistoryStore.getState().goBack("unknown")).toBeNull();
      expect(usePaneHistoryStore.getState().goForward("unknown")).toBeNull();
    });
  });

  describe("canGoBack / canGoForward", () => {
    it("both false for single-entry stack", () => {
      usePaneHistoryStore.getState().pushPage("p1", "a.md");
      expect(usePaneHistoryStore.getState().canGoBack("p1")).toBe(false);
      expect(usePaneHistoryStore.getState().canGoForward("p1")).toBe(false);
    });

    it("canGoBack true after pushing two pages", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      expect(usePaneHistoryStore.getState().canGoBack("p1")).toBe(true);
      expect(usePaneHistoryStore.getState().canGoForward("p1")).toBe(false);
    });

    it("canGoForward true after goBack", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      usePaneHistoryStore.getState().goBack("p1");
      expect(usePaneHistoryStore.getState().canGoBack("p1")).toBe(false);
      expect(usePaneHistoryStore.getState().canGoForward("p1")).toBe(true);
    });

    it("both false for unknown pane", () => {
      expect(usePaneHistoryStore.getState().canGoBack("nope")).toBe(false);
      expect(usePaneHistoryStore.getState().canGoForward("nope")).toBe(false);
    });
  });

  describe("removePaneHistory", () => {
    it("removes the stack for a pane", () => {
      usePaneHistoryStore.getState().pushPage("p1", "a.md");
      usePaneHistoryStore.getState().pushPage("p2", "b.md");
      usePaneHistoryStore.getState().removePaneHistory("p1");
      expect(usePaneHistoryStore.getState().stacks.has("p1")).toBe(false);
      expect(usePaneHistoryStore.getState().stacks.has("p2")).toBe(true);
    });
  });

  describe("clearPath", () => {
    it("removes all entries matching pagePath", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "a.md");
      usePaneHistoryStore.getState().clearPath("a.md");
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["b.md"]);
    });

    it("adjusts index when current entry is removed", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");
      // index is at 2 (c.md), go back to b.md (index 1)
      usePaneHistoryStore.getState().goBack("p1");
      // remove b.md
      usePaneHistoryStore.getState().clearPath("b.md");
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["a.md", "c.md"]);
      expect(stack.index).toBe(0);
      expect(stack.entries[stack.index]).toBe("a.md");
    });

    it("when current entry is the deleted page, index lands on the previous neighbor", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");
      // index is at 2 (c.md)
      usePaneHistoryStore.getState().clearPath("c.md");
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["a.md", "b.md"]);
      expect(stack.index).toBe(1);
      expect(stack.entries[stack.index]).toBe("b.md");
    });

    it("when current entry is the deleted page at index 0, index clamps to 0", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      // index is at 1 (b.md), go back to a.md (index 0)
      usePaneHistoryStore.getState().goBack("p1");
      // remove a.md (the current entry at index 0)
      usePaneHistoryStore.getState().clearPath("a.md");
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["b.md"]);
      expect(stack.index).toBe(0);
      expect(stack.entries[stack.index]).toBe("b.md");
    });

    it("when current entry is deleted and multiple occurrences exist, all removed and index prefers previous", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "a.md");
      // index is at 2 (a.md)
      usePaneHistoryStore.getState().clearPath("a.md");
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["b.md"]);
      expect(stack.index).toBe(0);
    });

    it("when current entry is deleted mid-stack, index picks the entry before the gap", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");
      store.pushPage("p1", "d.md");
      // index is at 3 (d.md), go back twice to index 1 (b.md)
      usePaneHistoryStore.getState().goBack("p1");
      usePaneHistoryStore.getState().goBack("p1");
      // remove b.md (the current entry at index 1)
      usePaneHistoryStore.getState().clearPath("b.md");
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["a.md", "c.md", "d.md"]);
      expect(stack.index).toBe(0);
      expect(stack.entries[stack.index]).toBe("a.md");
    });

    it("deletes the stack entirely when all entries are removed", () => {
      usePaneHistoryStore.getState().pushPage("p1", "a.md");
      usePaneHistoryStore.getState().clearPath("a.md");
      expect(usePaneHistoryStore.getState().stacks.has("p1")).toBe(false);
    });

    it("preserves index when current entry survives", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");
      // index is at 2 (c.md), remove a.md
      usePaneHistoryStore.getState().clearPath("a.md");
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["b.md", "c.md"]);
      expect(stack.entries[stack.index]).toBe("c.md");
    });

    it("no-ops when pagePath is not in any stack", () => {
      usePaneHistoryStore.getState().pushPage("p1", "a.md");
      usePaneHistoryStore.getState().clearPath("z.md");
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["a.md"]);
    });

    it("preserves correct index when duplicate entries exist", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "a.md");
      // index is at 2 (second "a.md"), remove "b.md"
      usePaneHistoryStore.getState().clearPath("b.md");
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["a.md", "a.md"]);
      // User was on the second "a.md", so index should be 1, NOT 0
      expect(stack.index).toBe(1);
      expect(stack.entries[stack.index]).toBe("a.md");
    });

    it("maps index correctly when multiple earlier entries are removed", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");   // index 0
      store.pushPage("p1", "x.md");   // index 1
      store.pushPage("p1", "b.md");   // index 2
      store.pushPage("p1", "x.md");   // index 3
      store.pushPage("p1", "c.md");   // index 4
      usePaneHistoryStore.getState().goBack("p1"); // index 3 (second "x.md")
      usePaneHistoryStore.getState().goBack("p1"); // index 2 ("b.md")
      // Now remove "x.md"
      usePaneHistoryStore.getState().clearPath("x.md");
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["a.md", "b.md", "c.md"]);
      // Was on "b.md" at old index 2, one "x.md" removed before it => new index 1
      expect(stack.index).toBe(1);
      expect(stack.entries[stack.index]).toBe("b.md");
    });
  });

  describe("renamePath", () => {
    it("rewrites matching entries across all pane stacks", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");

      // Set up a second pane
      usePaneStore.setState({
        root: {
          type: "split",
          id: "split1",
          direction: "horizontal",
          children: [
            { type: "leaf", id: "p1", pagePath: "c.md" },
            { type: "leaf", id: "p2", pagePath: "d.md" },
          ],
          sizes: [50, 50],
        },
        focusedPaneId: "p1",
      });
      store.pushPage("p2", "b.md");
      store.pushPage("p2", "d.md");

      usePaneHistoryStore.getState().renamePath("b.md", "b2.md");

      const s1 = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(s1.entries).toEqual(["a.md", "b2.md", "c.md"]);

      const s2 = usePaneHistoryStore.getState().stacks.get("p2")!;
      expect(s2.entries).toEqual(["b2.md", "d.md"]);
    });

    it("preserves index position", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");
      // Go back to b.md (index 1)
      usePaneHistoryStore.getState().goBack("p1");

      usePaneHistoryStore.getState().renamePath("b.md", "b2.md");

      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["a.md", "b2.md", "c.md"]);
      expect(stack.index).toBe(1);
    });

    it("handles multiple occurrences of the same path", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "a.md");

      usePaneHistoryStore.getState().renamePath("a.md", "a2.md");

      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["a2.md", "b.md", "a2.md"]);
      expect(stack.index).toBe(2);
    });

    it("no-ops when oldPath is not in any stack", () => {
      usePaneHistoryStore.getState().pushPage("p1", "a.md");

      usePaneHistoryStore.getState().renamePath("z.md", "z2.md");

      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["a.md"]);
    });

    it("no-ops on empty stacks map", () => {
      usePaneHistoryStore.getState().renamePath("a.md", "b.md");
      expect(usePaneHistoryStore.getState().stacks.size).toBe(0);
    });
  });

  describe("goBack / goForward with missing or stale pane", () => {
    it("goBack does not advance index when pane leaf no longer exists", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");
      // Remove the pane leaf so findLeaf returns null
      usePaneStore.setState({
        root: { type: "leaf", id: "other-pane", pagePath: null },
        focusedPaneId: "other-pane",
      });
      const result = usePaneHistoryStore.getState().goBack("p1");
      expect(result).toBeNull();
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.index).toBe(2); // unchanged
      expect(usePaneHistoryStore.getState().canGoBack("p1")).toBe(true);
    });

    it("goForward does not advance index when pane leaf no longer exists", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");
      // Go back to index 1 (b.md)
      usePaneHistoryStore.getState().goBack("p1");
      const stackBefore = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stackBefore.index).toBe(1);
      // Remove the pane leaf
      usePaneStore.setState({
        root: { type: "leaf", id: "other-pane", pagePath: null },
        focusedPaneId: "other-pane",
      });
      const result = usePaneHistoryStore.getState().goForward("p1");
      expect(result).toBeNull();
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.index).toBe(1); // unchanged
      expect(usePaneHistoryStore.getState().canGoForward("p1")).toBe(true);
    });

    it("goBack does not advance index when target page matches current pane page", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      // Externally navigate the pane back to "a.md" (the back-target)
      usePaneStore.getState().setPanePage("p1", "a.md");
      const result = usePaneHistoryStore.getState().goBack("p1");
      expect(result).toBeNull();
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.index).toBe(1); // unchanged
    });

    it("goForward does not advance index when target page matches current pane page", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      // Go back to a.md (index 0)
      usePaneHistoryStore.getState().goBack("p1");
      // Externally navigate the pane to "b.md" (the forward-target)
      usePaneStore.getState().setPanePage("p1", "b.md");
      const result = usePaneHistoryStore.getState().goForward("p1");
      expect(result).toBeNull();
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.index).toBe(0); // unchanged
    });
  });

  describe("goBack/goForward round-trip symmetry (navigate helper)", () => {
    it("goBack and goForward produce symmetric behavior through shared navigate path", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");

      // Go back twice: c.md -> b.md -> a.md
      const back1 = usePaneHistoryStore.getState().goBack("p1");
      const back2 = usePaneHistoryStore.getState().goBack("p1");
      expect(back1).toBe("b.md");
      expect(back2).toBe("a.md");
      expect(usePaneHistoryStore.getState().stacks.get("p1")!.index).toBe(0);

      // Go forward twice: a.md -> b.md -> c.md
      const fwd1 = usePaneHistoryStore.getState().goForward("p1");
      const fwd2 = usePaneHistoryStore.getState().goForward("p1");
      expect(fwd1).toBe("b.md");
      expect(fwd2).toBe("c.md");
      expect(usePaneHistoryStore.getState().stacks.get("p1")!.index).toBe(2);
    });

    it("navigate boundary guards are symmetric", () => {
      usePaneHistoryStore.getState().pushPage("p1", "a.md");
      // Lower bound: cannot go back from the only entry
      expect(usePaneHistoryStore.getState().goBack("p1")).toBeNull();
      // Upper bound: cannot go forward from the only entry
      expect(usePaneHistoryStore.getState().goForward("p1")).toBeNull();
      // Stack index unchanged
      expect(usePaneHistoryStore.getState().stacks.get("p1")!.index).toBe(0);
    });
  });

  describe("pushPage no-alloc on dedupe", () => {
    it("does not create a new stacks Map when page is a duplicate", () => {
      const { pushPage } = usePaneHistoryStore.getState();
      pushPage("p1", "a.md");
      const stacksBefore = usePaneHistoryStore.getState().stacks;
      pushPage("p1", "a.md"); // duplicate -- should no-op
      const stacksAfter = usePaneHistoryStore.getState().stacks;
      expect(stacksAfter).toBe(stacksBefore); // reference identity -- no clone
    });
  });

  describe("initPaneHistoryTracking root guard", () => {
    afterEach(() => {
      stopPaneHistoryTracking();
    });

    it("subscriber does not process focus-only pane store changes", () => {
      // Set up a two-pane layout
      usePaneStore.setState({
        root: {
          type: "split",
          id: "s1",
          direction: "horizontal",
          children: [
            { type: "leaf", id: "p1", pagePath: "a.md" },
            { type: "leaf", id: "p2", pagePath: "b.md" },
          ],
          sizes: [50, 50],
        },
        focusedPaneId: "p1",
      });

      // Push initial history so stacks is non-empty
      usePaneHistoryStore.getState().pushPage("p1", "a.md");
      usePaneHistoryStore.getState().pushPage("p2", "b.md");

      initPaneHistoryTracking();

      const stacksBefore = usePaneHistoryStore.getState().stacks;

      // Focus change -- should NOT trigger tree walk or pushPage
      usePaneStore.getState().focusPane("p2");
      usePaneStore.getState().focusPane("p1");
      usePaneStore.getState().focusPane("p2");

      const stacksAfter = usePaneHistoryStore.getState().stacks;
      expect(stacksAfter).toBe(stacksBefore); // no mutation at all
    });
  });

  describe("_isHistoryNavigation flag resilience", () => {
    afterEach(() => {
      stopPaneHistoryTracking();
    });

    it("goBack resets _isHistoryNavigation flag even when setPanePage throws", () => {
      // Setup history: a.md -> b.md -> c.md
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");
      usePaneStore.getState().setPanePage("p1", "c.md");

      // Start tracking so the subscriber records navigations
      initPaneHistoryTracking();

      // Monkey-patch setPanePage to throw
      const original = usePaneStore.getState().setPanePage;
      const setPanePageSpy = vi.fn(() => {
        throw new Error("setPanePage boom");
      });
      usePaneStore.setState({ setPanePage: setPanePageSpy });

      // goBack should throw because setPanePage throws
      expect(() => usePaneHistoryStore.getState().goBack("p1")).toThrow(
        "setPanePage boom",
      );

      // Restore original setPanePage
      usePaneStore.setState({ setPanePage: original });

      // Now do a normal navigation -- the subscriber should record it
      // because _isHistoryNavigation was reset to false
      usePaneStore.getState().setPanePage("p1", "d.md");

      // If the flag was stuck true, d.md would NOT be pushed
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toContain("d.md");
    });

    it("goForward resets _isHistoryNavigation flag even when setPanePage throws", () => {
      // Setup history: a.md -> b.md
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      usePaneStore.getState().setPanePage("p1", "b.md");

      // Go back to a.md (index 0) so we can go forward
      usePaneHistoryStore.getState().goBack("p1");

      // Start tracking so the subscriber records navigations
      initPaneHistoryTracking();

      // Monkey-patch setPanePage to throw
      const original = usePaneStore.getState().setPanePage;
      const setPanePageSpy = vi.fn(() => {
        throw new Error("setPanePage boom");
      });
      usePaneStore.setState({ setPanePage: setPanePageSpy });

      // goForward should throw because setPanePage throws
      expect(() => usePaneHistoryStore.getState().goForward("p1")).toThrow(
        "setPanePage boom",
      );

      // Restore original setPanePage
      usePaneStore.setState({ setPanePage: original });

      // Now do a normal navigation -- the subscriber should record it
      usePaneStore.getState().setPanePage("p1", "d.md");

      // If the flag was stuck true, d.md would NOT be pushed
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toContain("d.md");
    });
  });

  describe("navigate skips deleted pages", () => {
    function setWorkspacePages(paths: string[]) {
      useWorkspaceStore.setState({
        pages: paths.map((p) => ({
          title: p,
          relative_path: p,
          frontmatter: {},
          created_at: null,
          modified_at: null,
          file_type: "markdown" as const,
        })),
      });
    }

    it("goBack skips a single deleted intermediate page", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");
      // b.md deleted from workspace
      setWorkspacePages(["a.md", "c.md"]);
      const target = usePaneHistoryStore.getState().goBack("p1");
      expect(target).toBe("a.md");
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["a.md", "c.md"]);
      expect(stack.index).toBe(0);
    });

    it("goForward skips a single deleted intermediate page", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");
      // Go back twice to index 0
      usePaneHistoryStore.getState().goBack("p1");
      usePaneHistoryStore.getState().goBack("p1");
      // b.md deleted from workspace
      setWorkspacePages(["a.md", "c.md"]);
      const target = usePaneHistoryStore.getState().goForward("p1");
      expect(target).toBe("c.md");
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["a.md", "c.md"]);
      expect(stack.index).toBe(1);
    });

    it("goBack skips multiple consecutive deleted pages", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");
      store.pushPage("p1", "d.md");
      // b.md and c.md deleted
      setWorkspacePages(["a.md", "d.md"]);
      const target = usePaneHistoryStore.getState().goBack("p1");
      expect(target).toBe("a.md");
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["a.md", "d.md"]);
      expect(stack.index).toBe(0);
    });

    it("goBack returns null when all back entries are deleted", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");
      // a.md and b.md deleted
      setWorkspacePages(["c.md"]);
      const target = usePaneHistoryStore.getState().goBack("p1");
      expect(target).toBeNull();
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["c.md"]);
      expect(stack.index).toBe(0);
    });

    it("goForward returns null when all forward entries are deleted", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");
      // Go back twice to index 0
      usePaneHistoryStore.getState().goBack("p1");
      usePaneHistoryStore.getState().goBack("p1");
      // b.md and c.md deleted
      setWorkspacePages(["a.md"]);
      const target = usePaneHistoryStore.getState().goForward("p1");
      expect(target).toBeNull();
      const stack = usePaneHistoryStore.getState().stacks.get("p1")!;
      expect(stack.entries).toEqual(["a.md"]);
      expect(stack.index).toBe(0);
    });

    it("navigate prunes dead entries and canGoBack/canGoForward reflect reality after prune", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      // a.md deleted
      setWorkspacePages(["b.md"]);
      // Before navigation, canGoBack is stale (still reports true)
      expect(usePaneHistoryStore.getState().canGoBack("p1")).toBe(true);
      // Navigate triggers pruning
      const target = usePaneHistoryStore.getState().goBack("p1");
      expect(target).toBeNull();
      // After pruning, canGoBack reflects reality
      expect(usePaneHistoryStore.getState().canGoBack("p1")).toBe(false);
    });

    it("existing pages navigate exactly as before (no regression)", () => {
      const store = usePaneHistoryStore.getState();
      store.pushPage("p1", "a.md");
      store.pushPage("p1", "b.md");
      store.pushPage("p1", "c.md");
      // All pages exist
      setWorkspacePages(["a.md", "b.md", "c.md"]);
      const back1 = usePaneHistoryStore.getState().goBack("p1");
      expect(back1).toBe("b.md");
      const back2 = usePaneHistoryStore.getState().goBack("p1");
      expect(back2).toBe("a.md");
      const fwd1 = usePaneHistoryStore.getState().goForward("p1");
      expect(fwd1).toBe("b.md");
      const fwd2 = usePaneHistoryStore.getState().goForward("p1");
      expect(fwd2).toBe("c.md");
    });
  });

  describe("serialize / deserialize", () => {
    it("round-trips empty stacks", () => {
      const serialized = serializeHistory(new Map());
      expect(serialized).toEqual({});
      const deserialized = deserializeHistory({});
      expect(deserialized.size).toBe(0);
    });

    it("round-trips a single pane stack", () => {
      const stack: PaneHistoryStack = { entries: ["a.md", "b.md", "c.md"], index: 1 };
      const stacks = new Map([["p1", stack]]);
      const serialized = serializeHistory(stacks);
      const deserialized = deserializeHistory(serialized);
      expect(deserialized.size).toBe(1);
      expect(deserialized.get("p1")).toEqual(stack);
    });

    it("round-trips multiple pane stacks", () => {
      const s1: PaneHistoryStack = { entries: ["a.md", "b.md"], index: 0 };
      const s2: PaneHistoryStack = { entries: ["x.md", "y.md", "z.md"], index: 2 };
      const stacks = new Map([["p1", s1], ["p2", s2]]);
      const serialized = serializeHistory(stacks);
      const deserialized = deserializeHistory(serialized);
      expect(deserialized.size).toBe(2);
      expect(deserialized.get("p1")).toEqual(s1);
      expect(deserialized.get("p2")).toEqual(s2);
    });

    it("preserves mid-history index through round-trip", () => {
      const stack: PaneHistoryStack = { entries: ["a.md", "b.md", "c.md", "d.md"], index: 1 };
      const stacks = new Map([["p1", stack]]);
      const deserialized = deserializeHistory(serializeHistory(stacks));
      expect(deserialized.get("p1")!.index).toBe(1);
    });

    it("survives JSON.stringify/JSON.parse round-trip", () => {
      const s1: PaneHistoryStack = { entries: ["a.md", "b.md"], index: 0 };
      const s2: PaneHistoryStack = { entries: ["x.md"], index: 0 };
      const stacks = new Map([["p1", s1], ["p2", s2]]);
      const jsonSafe = JSON.parse(JSON.stringify(serializeHistory(stacks)));
      const deserialized = deserializeHistory(jsonSafe);
      expect(deserialized.size).toBe(2);
      expect(deserialized.get("p1")).toEqual(s1);
      expect(deserialized.get("p2")).toEqual(s2);
    });
  });
});

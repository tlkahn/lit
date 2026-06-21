import { describe, it, expect, beforeEach } from "vitest";
import { usePaneHistoryStore } from "./paneHistory";

function resetStore() {
  usePaneHistoryStore.setState({ stacks: new Map() });
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
      expect(stack.index).toBeLessThan(stack.entries.length);
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
  });
});

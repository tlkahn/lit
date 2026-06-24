import { describe, it, expect, beforeEach } from "vitest";
import { useRefNavStackStore } from "./refNavStack";

function resetStore() {
  useRefNavStackStore.setState({ stacks: new Map(), directions: new Map() });
}

describe("refNavStack store", () => {
  beforeEach(resetStore);

  describe("initial state", () => {
    it("has an empty stacks map", () => {
      expect(useRefNavStackStore.getState().stacks).toEqual(new Map());
    });

    it("current() returns null for unknown pane", () => {
      expect(useRefNavStackStore.getState().current("pane1")).toBeNull();
    });

    it("depth() returns 0 for unknown pane", () => {
      expect(useRefNavStackStore.getState().depth("pane1")).toBe(0);
    });
  });

  describe("push", () => {
    it("pushes onto empty pane stack", () => {
      useRefNavStackStore.getState().push("pane1", "a", "Note A");
      const entries = useRefNavStackStore.getState().stacks.get("pane1");
      expect(entries).toEqual([{ key: "a", title: "Note A" }]);
    });

    it("pushes multiple entries to same pane", () => {
      useRefNavStackStore.getState().push("pane1", "a", "Note A");
      useRefNavStackStore.getState().push("pane1", "b", "Note B");
      const entries = useRefNavStackStore.getState().stacks.get("pane1");
      expect(entries).toEqual([
        { key: "a", title: "Note A" },
        { key: "b", title: "Note B" },
      ]);
    });

    it("updates title in-place when key is already on stack", () => {
      useRefNavStackStore.getState().push("pane1", "a", "Note A");
      useRefNavStackStore.getState().push("pane1", "b", "Note B");
      useRefNavStackStore.getState().push("pane1", "a", "Renamed A");
      expect(useRefNavStackStore.getState().stacks.get("pane1")).toEqual([
        { key: "a", title: "Renamed A" },
        { key: "b", title: "Note B" },
      ]);
    });

    it("preserves reference identity on cycle-guard no-op", () => {
      useRefNavStackStore.getState().push("pane1", "a", "Note A");
      const stacksBefore = useRefNavStackStore.getState().stacks;
      useRefNavStackStore.getState().push("pane1", "a", "Note A");
      const stacksAfter = useRefNavStackStore.getState().stacks;
      expect(stacksAfter).toBe(stacksBefore);
    });

    it("title update on deep entry does not reorder stack", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane1", "b", "B");
      useRefNavStackStore.getState().push("pane1", "c", "C");
      useRefNavStackStore.getState().push("pane1", "a", "New A");
      expect(useRefNavStackStore.getState().stacks.get("pane1")).toEqual([
        { key: "a", title: "New A" },
        { key: "b", title: "B" },
        { key: "c", title: "C" },
      ]);
    });

    it("title update creates new stacks reference", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      const stacksBefore = useRefNavStackStore.getState().stacks;
      useRefNavStackStore.getState().push("pane1", "a", "New A");
      const stacksAfter = useRefNavStackStore.getState().stacks;
      expect(stacksAfter).not.toBe(stacksBefore);
    });
  });

  describe("pop", () => {
    it("returns top entry for pane", () => {
      useRefNavStackStore.getState().push("pane1", "a", "Note A");
      useRefNavStackStore.getState().push("pane1", "b", "Note B");
      const popped = useRefNavStackStore.getState().pop("pane1");
      expect(popped).toEqual({ key: "b", title: "Note B" });
    });

    it("returns null on empty pane stack", () => {
      expect(useRefNavStackStore.getState().pop("pane1")).toBeNull();
    });

    it("drains in LIFO order", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane1", "b", "B");
      useRefNavStackStore.getState().push("pane1", "c", "C");
      expect(useRefNavStackStore.getState().pop("pane1")).toEqual({ key: "c", title: "C" });
      expect(useRefNavStackStore.getState().pop("pane1")).toEqual({ key: "b", title: "B" });
      expect(useRefNavStackStore.getState().pop("pane1")).toEqual({ key: "a", title: "A" });
      expect(useRefNavStackStore.getState().pop("pane1")).toBeNull();
    });

    it("preserves reference identity on empty pop", () => {
      const stacksBefore = useRefNavStackStore.getState().stacks;
      useRefNavStackStore.getState().pop("pane1");
      const stacksAfter = useRefNavStackStore.getState().stacks;
      expect(stacksAfter).toBe(stacksBefore);
    });

    it("popped entry includes correct key and title", () => {
      useRefNavStackStore.getState().push("pane1", "x", "Title X");
      const entry = useRefNavStackStore.getState().pop("pane1");
      expect(entry!.key).toBe("x");
      expect(entry!.title).toBe("Title X");
    });
  });

  describe("reset", () => {
    it("clears the pane stack", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane1", "b", "B");
      useRefNavStackStore.getState().reset("pane1");
      expect(useRefNavStackStore.getState().stacks.get("pane1")).toBeUndefined();
    });

    it("preserves reference identity on empty reset", () => {
      const stacksBefore = useRefNavStackStore.getState().stacks;
      useRefNavStackStore.getState().reset("pane1");
      const stacksAfter = useRefNavStackStore.getState().stacks;
      expect(stacksAfter).toBe(stacksBefore);
    });

    it("current and depth correct after reset", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().reset("pane1");
      expect(useRefNavStackStore.getState().current("pane1")).toBeNull();
      expect(useRefNavStackStore.getState().depth("pane1")).toBe(0);
    });
  });

  describe("current", () => {
    it("returns top entry after push", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane1", "b", "B");
      expect(useRefNavStackStore.getState().current("pane1")).toEqual({ key: "b", title: "B" });
    });

    it("returns new top after pop", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane1", "b", "B");
      useRefNavStackStore.getState().pop("pane1");
      expect(useRefNavStackStore.getState().current("pane1")).toEqual({ key: "a", title: "A" });
    });

    it("returns null after reset", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().reset("pane1");
      expect(useRefNavStackStore.getState().current("pane1")).toBeNull();
    });
  });

  describe("depth", () => {
    it("counts entries correctly", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      expect(useRefNavStackStore.getState().depth("pane1")).toBe(1);
      useRefNavStackStore.getState().push("pane1", "b", "B");
      expect(useRefNavStackStore.getState().depth("pane1")).toBe(2);
    });

    it("decrements on pop", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane1", "b", "B");
      useRefNavStackStore.getState().pop("pane1");
      expect(useRefNavStackStore.getState().depth("pane1")).toBe(1);
    });
  });

  describe("isOnStack", () => {
    it("returns false on empty pane stack", () => {
      expect(useRefNavStackStore.getState().isOnStack("pane1", "a")).toBe(false);
    });

    it("returns true for pushed key", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      expect(useRefNavStackStore.getState().isOnStack("pane1", "a")).toBe(true);
    });

    it("returns true for deep entry", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane1", "b", "B");
      useRefNavStackStore.getState().push("pane1", "c", "C");
      expect(useRefNavStackStore.getState().isOnStack("pane1", "a")).toBe(true);
    });

    it("returns false after pop removes the key", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().pop("pane1");
      expect(useRefNavStackStore.getState().isOnStack("pane1", "a")).toBe(false);
    });

    it("returns false after reset", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().reset("pane1");
      expect(useRefNavStackStore.getState().isOnStack("pane1", "a")).toBe(false);
    });
  });

  describe("cycle guard", () => {
    it("push A, push B, push A (same title) = no-op", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane1", "b", "B");
      useRefNavStackStore.getState().push("pane1", "a", "A");
      expect(useRefNavStackStore.getState().depth("pane1")).toBe(2);
      expect(useRefNavStackStore.getState().current("pane1")).toEqual({ key: "b", title: "B" });
    });

    it("after pop removes A, push A succeeds", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane1", "b", "B");
      useRefNavStackStore.getState().pop("pane1");
      useRefNavStackStore.getState().pop("pane1");
      useRefNavStackStore.getState().push("pane1", "a", "New A");
      expect(useRefNavStackStore.getState().stacks.get("pane1")).toEqual([{ key: "a", title: "New A" }]);
    });

    it("isOnStack reflects state through push/pop/reset", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      expect(useRefNavStackStore.getState().isOnStack("pane1", "a")).toBe(true);

      useRefNavStackStore.getState().push("pane1", "b", "B");
      expect(useRefNavStackStore.getState().isOnStack("pane1", "a")).toBe(true);
      expect(useRefNavStackStore.getState().isOnStack("pane1", "b")).toBe(true);

      useRefNavStackStore.getState().pop("pane1");
      expect(useRefNavStackStore.getState().isOnStack("pane1", "b")).toBe(false);
      expect(useRefNavStackStore.getState().isOnStack("pane1", "a")).toBe(true);

      useRefNavStackStore.getState().reset("pane1");
      expect(useRefNavStackStore.getState().isOnStack("pane1", "a")).toBe(false);
    });
  });

  describe("cross-pane isolation", () => {
    it("push to different panes independently", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane2", "x", "X");
      expect(useRefNavStackStore.getState().stacks.get("pane1")).toEqual([{ key: "a", title: "A" }]);
      expect(useRefNavStackStore.getState().stacks.get("pane2")).toEqual([{ key: "x", title: "X" }]);
    });

    it("pop from one pane does not affect the other", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane2", "x", "X");
      const popped = useRefNavStackStore.getState().pop("pane1");
      expect(popped).toEqual({ key: "a", title: "A" });
      expect(useRefNavStackStore.getState().depth("pane2")).toBe(1);
      expect(useRefNavStackStore.getState().current("pane2")).toEqual({ key: "x", title: "X" });
    });

    it("depth is scoped to the pane", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane1", "b", "B");
      useRefNavStackStore.getState().push("pane2", "x", "X");
      expect(useRefNavStackStore.getState().depth("pane1")).toBe(2);
      expect(useRefNavStackStore.getState().depth("pane2")).toBe(1);
    });

    it("reset one pane does not clear the other", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane2", "x", "X");
      useRefNavStackStore.getState().reset("pane1");
      expect(useRefNavStackStore.getState().stacks.get("pane1")).toBeUndefined();
      expect(useRefNavStackStore.getState().stacks.get("pane2")).toEqual([{ key: "x", title: "X" }]);
    });

    it("isOnStack is scoped to the pane", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane2", "b", "B");
      expect(useRefNavStackStore.getState().isOnStack("pane1", "a")).toBe(true);
      expect(useRefNavStackStore.getState().isOnStack("pane1", "b")).toBe(false);
      expect(useRefNavStackStore.getState().isOnStack("pane2", "b")).toBe(true);
      expect(useRefNavStackStore.getState().isOnStack("pane2", "a")).toBe(false);
    });
  });

  describe("direction tracking", () => {
    it("direction defaults to 'none' for unknown pane", () => {
      expect(useRefNavStackStore.getState().direction("pane1")).toBe("none");
    });

    it("push sets direction to 'push'", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      expect(useRefNavStackStore.getState().direction("pane1")).toBe("push");
    });

    it("pop sets direction to 'pop'", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane1", "b", "B");
      useRefNavStackStore.getState().pop("pane1");
      expect(useRefNavStackStore.getState().direction("pane1")).toBe("pop");
    });

    it("reset sets direction to 'none'", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().reset("pane1");
      expect(useRefNavStackStore.getState().direction("pane1")).toBe("none");
    });

    it("cycle-guard no-op does not change direction", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      expect(useRefNavStackStore.getState().direction("pane1")).toBe("push");
      useRefNavStackStore.getState().clearDirection("pane1");
      expect(useRefNavStackStore.getState().direction("pane1")).toBe("none");
      useRefNavStackStore.getState().push("pane1", "a", "A");
      expect(useRefNavStackStore.getState().direction("pane1")).toBe("none");
    });

    it("title-update push does not change direction", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().clearDirection("pane1");
      useRefNavStackStore.getState().push("pane1", "a", "New A");
      expect(useRefNavStackStore.getState().direction("pane1")).toBe("none");
    });

    it("clearDirection resets to 'none'", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      expect(useRefNavStackStore.getState().direction("pane1")).toBe("push");
      useRefNavStackStore.getState().clearDirection("pane1");
      expect(useRefNavStackStore.getState().direction("pane1")).toBe("none");
    });

    it("clearDirection is a no-op when already 'none'", () => {
      const dirsBefore = useRefNavStackStore.getState().directions;
      useRefNavStackStore.getState().clearDirection("pane1");
      const dirsAfter = useRefNavStackStore.getState().directions;
      expect(dirsAfter).toBe(dirsBefore);
    });

    it("directions are isolated across panes", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane2", "x", "X");
      useRefNavStackStore.getState().pop("pane1");
      expect(useRefNavStackStore.getState().direction("pane1")).toBe("pop");
      expect(useRefNavStackStore.getState().direction("pane2")).toBe("push");
    });
  });

  describe("removePaneStack", () => {
    it("removes the pane entry from stacks", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane1", "b", "B");
      useRefNavStackStore.getState().removePaneStack("pane1");
      expect(useRefNavStackStore.getState().stacks.has("pane1")).toBe(false);
    });

    it("does not affect other panes", () => {
      useRefNavStackStore.getState().push("pane1", "a", "A");
      useRefNavStackStore.getState().push("pane2", "x", "X");
      useRefNavStackStore.getState().removePaneStack("pane1");
      expect(useRefNavStackStore.getState().stacks.has("pane1")).toBe(false);
      expect(useRefNavStackStore.getState().stacks.get("pane2")).toEqual([{ key: "x", title: "X" }]);
    });

    it("preserves reference identity when pane does not exist", () => {
      const stacksBefore = useRefNavStackStore.getState().stacks;
      useRefNavStackStore.getState().removePaneStack("nonexistent");
      const stacksAfter = useRefNavStackStore.getState().stacks;
      expect(stacksAfter).toBe(stacksBefore);
    });
  });
});

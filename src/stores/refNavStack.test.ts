import { describe, it, expect, beforeEach } from "vitest";
import { useRefNavStackStore } from "./refNavStack";

function resetStore() {
  useRefNavStackStore.setState({ stack: [] });
}

describe("refNavStack store", () => {
  beforeEach(resetStore);

  describe("initial state", () => {
    it("has an empty stack", () => {
      expect(useRefNavStackStore.getState().stack).toEqual([]);
    });

    it("current() returns null", () => {
      expect(useRefNavStackStore.getState().current()).toBeNull();
    });

    it("depth() returns 0", () => {
      expect(useRefNavStackStore.getState().depth()).toBe(0);
    });
  });

  describe("push", () => {
    it("pushes onto empty stack", () => {
      useRefNavStackStore.getState().push("a", "Note A");
      const { stack } = useRefNavStackStore.getState();
      expect(stack).toEqual([{ key: "a", title: "Note A" }]);
    });

    it("pushes multiple entries", () => {
      const s = useRefNavStackStore.getState();
      s.push("a", "Note A");
      useRefNavStackStore.getState().push("b", "Note B");
      const { stack } = useRefNavStackStore.getState();
      expect(stack).toEqual([
        { key: "a", title: "Note A" },
        { key: "b", title: "Note B" },
      ]);
    });

    it("no-ops when key is already on stack (cycle guard)", () => {
      const s = useRefNavStackStore.getState();
      s.push("a", "Note A");
      useRefNavStackStore.getState().push("b", "Note B");
      useRefNavStackStore.getState().push("a", "Note A again");
      expect(useRefNavStackStore.getState().stack).toEqual([
        { key: "a", title: "Note A" },
        { key: "b", title: "Note B" },
      ]);
    });

    it("preserves reference identity on cycle-guard no-op", () => {
      useRefNavStackStore.getState().push("a", "Note A");
      const stackBefore = useRefNavStackStore.getState().stack;
      useRefNavStackStore.getState().push("a", "Different Title");
      const stackAfter = useRefNavStackStore.getState().stack;
      expect(stackAfter).toBe(stackBefore);
    });
  });

  describe("pop", () => {
    it("returns top entry", () => {
      useRefNavStackStore.getState().push("a", "Note A");
      useRefNavStackStore.getState().push("b", "Note B");
      const popped = useRefNavStackStore.getState().pop();
      expect(popped).toEqual({ key: "b", title: "Note B" });
    });

    it("returns null on empty stack", () => {
      expect(useRefNavStackStore.getState().pop()).toBeNull();
    });

    it("drains in LIFO order", () => {
      useRefNavStackStore.getState().push("a", "A");
      useRefNavStackStore.getState().push("b", "B");
      useRefNavStackStore.getState().push("c", "C");
      expect(useRefNavStackStore.getState().pop()).toEqual({ key: "c", title: "C" });
      expect(useRefNavStackStore.getState().pop()).toEqual({ key: "b", title: "B" });
      expect(useRefNavStackStore.getState().pop()).toEqual({ key: "a", title: "A" });
      expect(useRefNavStackStore.getState().pop()).toBeNull();
    });

    it("preserves reference identity on empty pop", () => {
      const stackBefore = useRefNavStackStore.getState().stack;
      useRefNavStackStore.getState().pop();
      const stackAfter = useRefNavStackStore.getState().stack;
      expect(stackAfter).toBe(stackBefore);
    });

    it("popped entry includes correct key and title", () => {
      useRefNavStackStore.getState().push("x", "Title X");
      const entry = useRefNavStackStore.getState().pop();
      expect(entry!.key).toBe("x");
      expect(entry!.title).toBe("Title X");
    });
  });

  describe("reset", () => {
    it("clears the stack", () => {
      useRefNavStackStore.getState().push("a", "A");
      useRefNavStackStore.getState().push("b", "B");
      useRefNavStackStore.getState().reset();
      expect(useRefNavStackStore.getState().stack).toEqual([]);
    });

    it("preserves reference identity on empty reset", () => {
      const stackBefore = useRefNavStackStore.getState().stack;
      useRefNavStackStore.getState().reset();
      const stackAfter = useRefNavStackStore.getState().stack;
      expect(stackAfter).toBe(stackBefore);
    });

    it("current and depth correct after reset", () => {
      useRefNavStackStore.getState().push("a", "A");
      useRefNavStackStore.getState().reset();
      expect(useRefNavStackStore.getState().current()).toBeNull();
      expect(useRefNavStackStore.getState().depth()).toBe(0);
    });
  });

  describe("current", () => {
    it("returns top entry after push", () => {
      useRefNavStackStore.getState().push("a", "A");
      useRefNavStackStore.getState().push("b", "B");
      expect(useRefNavStackStore.getState().current()).toEqual({ key: "b", title: "B" });
    });

    it("returns new top after pop", () => {
      useRefNavStackStore.getState().push("a", "A");
      useRefNavStackStore.getState().push("b", "B");
      useRefNavStackStore.getState().pop();
      expect(useRefNavStackStore.getState().current()).toEqual({ key: "a", title: "A" });
    });

    it("returns null after reset", () => {
      useRefNavStackStore.getState().push("a", "A");
      useRefNavStackStore.getState().reset();
      expect(useRefNavStackStore.getState().current()).toBeNull();
    });
  });

  describe("depth", () => {
    it("counts entries correctly", () => {
      useRefNavStackStore.getState().push("a", "A");
      expect(useRefNavStackStore.getState().depth()).toBe(1);
      useRefNavStackStore.getState().push("b", "B");
      expect(useRefNavStackStore.getState().depth()).toBe(2);
    });

    it("decrements on pop", () => {
      useRefNavStackStore.getState().push("a", "A");
      useRefNavStackStore.getState().push("b", "B");
      useRefNavStackStore.getState().pop();
      expect(useRefNavStackStore.getState().depth()).toBe(1);
    });
  });

  describe("isOnStack", () => {
    it("returns false on empty stack", () => {
      expect(useRefNavStackStore.getState().isOnStack("a")).toBe(false);
    });

    it("returns true for pushed key", () => {
      useRefNavStackStore.getState().push("a", "A");
      expect(useRefNavStackStore.getState().isOnStack("a")).toBe(true);
    });

    it("returns true for deep entry", () => {
      useRefNavStackStore.getState().push("a", "A");
      useRefNavStackStore.getState().push("b", "B");
      useRefNavStackStore.getState().push("c", "C");
      expect(useRefNavStackStore.getState().isOnStack("a")).toBe(true);
    });

    it("returns false after pop removes the key", () => {
      useRefNavStackStore.getState().push("a", "A");
      useRefNavStackStore.getState().pop();
      expect(useRefNavStackStore.getState().isOnStack("a")).toBe(false);
    });

    it("returns false after reset", () => {
      useRefNavStackStore.getState().push("a", "A");
      useRefNavStackStore.getState().reset();
      expect(useRefNavStackStore.getState().isOnStack("a")).toBe(false);
    });
  });

  describe("cycle guard", () => {
    it("push A, push B, push A = no-op", () => {
      const s = useRefNavStackStore.getState();
      s.push("a", "A");
      useRefNavStackStore.getState().push("b", "B");
      useRefNavStackStore.getState().push("a", "A");
      expect(useRefNavStackStore.getState().depth()).toBe(2);
      expect(useRefNavStackStore.getState().current()).toEqual({ key: "b", title: "B" });
    });

    it("after pop removes A, push A succeeds", () => {
      useRefNavStackStore.getState().push("a", "A");
      useRefNavStackStore.getState().push("b", "B");
      // pop B
      useRefNavStackStore.getState().pop();
      // pop A
      useRefNavStackStore.getState().pop();
      // now A is not on stack, push should succeed
      useRefNavStackStore.getState().push("a", "New A");
      expect(useRefNavStackStore.getState().stack).toEqual([{ key: "a", title: "New A" }]);
    });

    it("isOnStack reflects state through push/pop/reset", () => {
      useRefNavStackStore.getState().push("a", "A");
      expect(useRefNavStackStore.getState().isOnStack("a")).toBe(true);

      useRefNavStackStore.getState().push("b", "B");
      expect(useRefNavStackStore.getState().isOnStack("a")).toBe(true);
      expect(useRefNavStackStore.getState().isOnStack("b")).toBe(true);

      useRefNavStackStore.getState().pop(); // removes B
      expect(useRefNavStackStore.getState().isOnStack("b")).toBe(false);
      expect(useRefNavStackStore.getState().isOnStack("a")).toBe(true);

      useRefNavStackStore.getState().reset();
      expect(useRefNavStackStore.getState().isOnStack("a")).toBe(false);
    });
  });
});

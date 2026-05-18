import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  acquire,
  release,
  getPaneIds,
  getDoc,
  setContent,
  subscribe,
  setBody,
  isDirty,
  isShared,
  _resetForTesting,
} from "./sharedDocs";
import { writePage } from "./ipc";

vi.mock("./ipc", () => ({
  writePage: vi.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  vi.useFakeTimers();
  _resetForTesting();
  vi.mocked(writePage).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SharedDocRegistry", () => {
  describe("acquire / getPaneIds / getDoc", () => {
    it("acquire registers a pane and getPaneIds returns it", () => {
      acquire("notes.md", "p1");
      expect(getPaneIds("notes.md")).toEqual(["p1"]);
    });

    it("second acquire adds to the set", () => {
      acquire("notes.md", "p1");
      acquire("notes.md", "p2");
      expect(getPaneIds("notes.md")).toEqual(["p1", "p2"]);
    });

    it("getDoc returns the SharedDoc object after acquire", () => {
      acquire("notes.md", "p1");
      const doc = getDoc("notes.md");
      expect(doc).not.toBeNull();
    });

    it("getDoc returns null for unknown path", () => {
      expect(getDoc("unknown.md")).toBeNull();
    });

    it("acquire same paneId twice is idempotent", () => {
      acquire("notes.md", "p1");
      acquire("notes.md", "p1");
      expect(getPaneIds("notes.md")).toEqual(["p1"]);
    });
  });

  describe("release with refcounting", () => {
    it("release removes paneId, doc persists while panes remain", () => {
      acquire("notes.md", "p1");
      acquire("notes.md", "p2");
      release("notes.md", "p2");
      expect(getPaneIds("notes.md")).toEqual(["p1"]);
      expect(getDoc("notes.md")).not.toBeNull();
    });

    it("release last pane removes the doc entry", () => {
      acquire("notes.md", "p1");
      release("notes.md", "p1");
      expect(getDoc("notes.md")).toBeNull();
    });

    it("release unknown path is a no-op", () => {
      expect(() => release("unknown.md", "p1")).not.toThrow();
    });

    it("release unknown paneId is a no-op", () => {
      acquire("notes.md", "p1");
      expect(() => release("notes.md", "p99")).not.toThrow();
      expect(getPaneIds("notes.md")).toEqual(["p1"]);
    });

  });

  describe("setContent for initial load", () => {
    it("stores all content fields on the doc", () => {
      acquire("notes.md", "p1");
      setContent("notes.md", {
        body: "# Hello",
        title: "Hello",
        frontmatter: { tags: ["a"] },
        rawYaml: "tags:\n  - a\n",
      });
      const doc = getDoc("notes.md");
      expect(doc).not.toBeNull();
      expect(doc!.body).toBe("# Hello");
      expect(doc!.title).toBe("Hello");
      expect(doc!.frontmatter).toEqual({ tags: ["a"] });
      expect(doc!.rawYaml).toBe("tags:\n  - a\n");
    });

    it("does NOT trigger subscriber notifications", () => {
      acquire("notes.md", "p1");
      const cb = vi.fn();
      subscribe("notes.md", "p1", cb);
      setContent("notes.md", {
        body: "# Hello",
        title: "Hello",
        frontmatter: {},
        rawYaml: "",
      });
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("subscribe / setBody notifies siblings", () => {
    it("setBody notifies sibling but not the editing pane", () => {
      acquire("notes.md", "p1");
      acquire("notes.md", "p2");
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      subscribe("notes.md", "p1", cb1);
      subscribe("notes.md", "p2", cb2);

      setBody("notes.md", "new content", "p2");

      expect(cb1).toHaveBeenCalledWith("new content", "p2");
      expect(cb2).not.toHaveBeenCalled();
    });

    it("callback fires synchronously", () => {
      acquire("notes.md", "p1");
      acquire("notes.md", "p2");
      let calledDuringSetBody = false;
      subscribe("notes.md", "p1", () => {
        calledDuringSetBody = true;
      });
      setBody("notes.md", "sync", "p2");
      expect(calledDuringSetBody).toBe(true);
    });

    it("getDoc().body is updated after setBody", () => {
      acquire("notes.md", "p1");
      setBody("notes.md", "updated", "p1");
      expect(getDoc("notes.md")!.body).toBe("updated");
    });

    it("unsubscribe stops future callbacks", () => {
      acquire("notes.md", "p1");
      acquire("notes.md", "p2");
      const cb = vi.fn();
      const unsub = subscribe("notes.md", "p1", cb);

      unsub();
      setBody("notes.md", "after unsub", "p2");

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("release auto-unsubscribes", () => {
    it("released pane's subscriber is not called on subsequent setBody", () => {
      acquire("notes.md", "p1");
      acquire("notes.md", "p2");
      const cb = vi.fn();
      subscribe("notes.md", "p1", cb);

      release("notes.md", "p1");
      setBody("notes.md", "after release", "p2");

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("centralized debounced save", () => {
    it("setBody triggers writePage after 300ms", () => {
      acquire("notes.md", "p1");
      setContent("notes.md", {
        body: "old",
        title: "T",
        frontmatter: { tags: ["a"] },
        rawYaml: "",
      });
      setBody("notes.md", "new body", "p1");

      expect(writePage).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(writePage).toHaveBeenCalledOnce();
      expect(writePage).toHaveBeenCalledWith("notes.md", "new body", { tags: ["a"] });
    });

    it("3 rapid setBody calls within 300ms result in only 1 writePage with final body", () => {
      acquire("notes.md", "p1");
      setContent("notes.md", { body: "", title: "T", frontmatter: {}, rawYaml: "" });

      setBody("notes.md", "first", "p1");
      vi.advanceTimersByTime(100);
      setBody("notes.md", "second", "p1");
      vi.advanceTimersByTime(100);
      setBody("notes.md", "third", "p1");
      vi.advanceTimersByTime(300);

      expect(writePage).toHaveBeenCalledOnce();
      expect(writePage).toHaveBeenCalledWith("notes.md", "third", {});
    });

    it("isDirty becomes true on setBody, false after save", async () => {
      acquire("notes.md", "p1");
      setContent("notes.md", { body: "", title: "T", frontmatter: {}, rawYaml: "" });

      expect(isDirty("notes.md")).toBe(false);
      setBody("notes.md", "edited", "p1");
      expect(isDirty("notes.md")).toBe(true);

      vi.advanceTimersByTime(300);
      await vi.advanceTimersByTimeAsync(0);
      expect(isDirty("notes.md")).toBe(false);
    });

    it("edit during save flight keeps isDirty true", async () => {
      let resolveWrite!: () => void;
      vi.mocked(writePage).mockImplementation(
        () => new Promise<void>((r) => { resolveWrite = r; }),
      );

      acquire("notes.md", "p1");
      setContent("notes.md", { body: "", title: "T", frontmatter: {}, rawYaml: "" });

      setBody("notes.md", "v1", "p1");
      vi.advanceTimersByTime(300);

      setBody("notes.md", "v2", "p1");

      resolveWrite();
      await vi.advanceTimersByTimeAsync(0);

      expect(isDirty("notes.md")).toBe(true);
    });

    it("release last pane with pending save flushes immediately", () => {
      acquire("notes.md", "p1");
      setContent("notes.md", { body: "", title: "T", frontmatter: {}, rawYaml: "" });

      setBody("notes.md", "unsaved", "p1");
      expect(writePage).not.toHaveBeenCalled();

      release("notes.md", "p1");
      expect(writePage).toHaveBeenCalledOnce();
      expect(writePage).toHaveBeenCalledWith("notes.md", "unsaved", {});
    });

    it("save failure keeps isDirty true", async () => {
      vi.mocked(writePage).mockImplementation(
        () => Promise.reject(new Error("disk full")),
      );

      acquire("notes.md", "p1");
      setContent("notes.md", { body: "", title: "T", frontmatter: {}, rawYaml: "" });

      setBody("notes.md", "edited", "p1");
      vi.advanceTimersByTime(300);
      await vi.advanceTimersByTimeAsync(0);

      expect(isDirty("notes.md")).toBe(true);
    });

    it("no duplicate save when in-flight save covers latest edit", async () => {
      let resolveWrite!: () => void;
      vi.mocked(writePage).mockImplementation(
        () => new Promise<void>((r) => { resolveWrite = r; }),
      );

      acquire("notes.md", "p1");
      setContent("notes.md", { body: "", title: "T", frontmatter: {}, rawYaml: "" });

      setBody("notes.md", "v1", "p1");
      vi.advanceTimersByTime(300);

      release("notes.md", "p1");
      expect(writePage).toHaveBeenCalledOnce();

      resolveWrite();
      await vi.advanceTimersByTimeAsync(0);
    });

    it("flush still happens when new edits arrive after in-flight save started", async () => {
      let resolveWrite!: () => void;
      vi.mocked(writePage).mockImplementation(
        () => new Promise<void>((r) => { resolveWrite = r; }),
      );

      acquire("notes.md", "p1");
      setContent("notes.md", { body: "", title: "T", frontmatter: {}, rawYaml: "" });

      setBody("notes.md", "v1", "p1");
      vi.advanceTimersByTime(300);
      expect(writePage).toHaveBeenCalledOnce();

      setBody("notes.md", "v2", "p1");
      release("notes.md", "p1");

      expect(writePage).toHaveBeenCalledTimes(2);
      expect(writePage).toHaveBeenLastCalledWith("notes.md", "v2", {});

      resolveWrite();
      await vi.advanceTimersByTimeAsync(0);
    });

    it("release cancels timer so it does not fire after flush", () => {
      acquire("notes.md", "p1");
      setContent("notes.md", { body: "", title: "T", frontmatter: {}, rawYaml: "" });

      setBody("notes.md", "unsaved", "p1");
      release("notes.md", "p1");
      expect(writePage).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(300);
      expect(writePage).toHaveBeenCalledOnce();
    });
  });

  describe("misc", () => {
    it("_resetForTesting clears all state", () => {
      acquire("a.md", "p1");
      acquire("b.md", "p2");
      _resetForTesting();
      expect(getDoc("a.md")).toBeNull();
      expect(getDoc("b.md")).toBeNull();
    });
  });

  describe("isShared", () => {
    it("returns false with 1 pane", () => {
      acquire("notes.md", "p1");
      expect(isShared("notes.md")).toBe(false);
    });

    it("returns true with 2 panes", () => {
      acquire("notes.md", "p1");
      acquire("notes.md", "p2");
      expect(isShared("notes.md")).toBe(true);
    });

    it("returns false after releasing back to 1 pane", () => {
      acquire("notes.md", "p1");
      acquire("notes.md", "p2");
      release("notes.md", "p2");
      expect(isShared("notes.md")).toBe(false);
    });

    it("returns false for unknown path", () => {
      expect(isShared("unknown.md")).toBe(false);
    });
  });
});

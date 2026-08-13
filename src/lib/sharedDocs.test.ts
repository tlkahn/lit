import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  acquire,
  release,
  getPaneIds,
  getDoc,
  setContent,
  subscribe,
  subscribeSaveSettled,
  subscribeContentReload,
  startReload,
  finishReload,
  cancelReload,
  setBody,
  isDirty,
  isShared,
  renamePath,
  flushSave,
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

    it("release with in-flight save defers delete; re-acquire reuses the edited in-memory body", async () => {
      acquire("notes.md", "p1");
      setContent("notes.md", { body: "old", title: "T", frontmatter: {}, rawYaml: "" });
      setBody("notes.md", "edited", "p1");

      // Manually-controlled deferred write so we can observe the in-flight window.
      let resolveWrite!: () => void;
      vi.mocked(writePage).mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            resolveWrite = () => r();
          }),
      );

      release("notes.md", "p1");
      expect(writePage).toHaveBeenCalledWith("notes.md", "edited", {});

      // Doc must NOT be deleted while the save is still in flight.
      expect(getDoc("notes.md")).not.toBeNull();

      // Re-open the same file before the write lands.
      acquire("notes.md", "p2");
      const doc = getDoc("notes.md");
      expect(doc).not.toBeNull();
      // Reused in-memory doc, not a fresh empty one.
      expect(doc!.loaded).toBe(true);
      expect(doc!.body).toBe("edited");

      // Let the save .then run; doc stays because p2 holds it.
      resolveWrite();
      await vi.advanceTimersByTimeAsync(0);
      expect(getDoc("notes.md")).not.toBeNull();
      expect(getDoc("notes.md")!.body).toBe("edited");
    });

    it("release with in-flight save (no new edits since save started) defers delete until save settles", async () => {
      acquire("notes.md", "p1");
      setContent("notes.md", { body: "old", title: "T", frontmatter: {}, rawYaml: "" });
      setBody("notes.md", "edited", "p1");

      let resolveWrite!: () => void;
      vi.mocked(writePage).mockImplementationOnce(
        () => new Promise<void>((r) => { resolveWrite = r; }),
      );

      // Fire the debounce timer — starts the save (saveInFlightGen becomes 1).
      vi.advanceTimersByTime(300);
      expect(writePage).toHaveBeenCalledOnce();

      // Release with no new edits since the save started (Branch 2).
      release("notes.md", "p1");
      // Doc must NOT be deleted while the save is still in flight.
      expect(getDoc("notes.md")).not.toBeNull();

      // Settle the write — now the deferred maybeDelete runs.
      resolveWrite();
      await vi.advanceTimersByTimeAsync(0);
      expect(getDoc("notes.md")).toBeNull();
    });

    it("release with in-flight save (no new edits) allows re-acquire to reuse in-memory doc", async () => {
      acquire("notes.md", "p1");
      setContent("notes.md", { body: "old", title: "T", frontmatter: {}, rawYaml: "" });
      setBody("notes.md", "edited", "p1");

      let resolveWrite!: () => void;
      vi.mocked(writePage).mockImplementationOnce(
        () => new Promise<void>((r) => { resolveWrite = r; }),
      );

      vi.advanceTimersByTime(300);
      release("notes.md", "p1");

      // Re-acquire before the save settles.
      acquire("notes.md", "p2");
      const doc = getDoc("notes.md");
      expect(doc).not.toBeNull();
      expect(doc!.loaded).toBe(true);
      expect(doc!.body).toBe("edited");

      // Settle the write — doc survives because p2 holds it.
      resolveWrite();
      await vi.advanceTimersByTimeAsync(0);
      expect(getDoc("notes.md")).not.toBeNull();
      expect(getDoc("notes.md")!.body).toBe("edited");
    });

    it("deferred delete still collects the entry once truly idle (reopen then close)", async () => {
      acquire("notes.md", "p1");
      setContent("notes.md", { body: "old", title: "T", frontmatter: {}, rawYaml: "" });
      setBody("notes.md", "edited", "p1");

      let resolveWrite!: () => void;
      vi.mocked(writePage).mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            resolveWrite = () => r();
          }),
      );

      release("notes.md", "p1");
      acquire("notes.md", "p2");
      resolveWrite();
      await vi.advanceTimersByTimeAsync(0);
      expect(getDoc("notes.md")).not.toBeNull();

      // Close p2 with no new edits — entry should be collected.
      release("notes.md", "p2");
      await vi.advanceTimersByTimeAsync(0);
      expect(getDoc("notes.md")).toBeNull();
    });
  });

  describe("renamePath", () => {
    it("moves the doc to the new path and applies the patch", () => {
      acquire("old.md", "p1");
      setContent("old.md", {
        body: "# Old",
        title: "Old",
        frontmatter: { tags: ["a"] },
        rawYaml: "tags:\n  - a\n",
      });

      renamePath("old.md", "new.md", { title: "New" });

      expect(getDoc("old.md")).toBeNull();
      const doc = getDoc("new.md");
      expect(doc).not.toBeNull();
      expect(doc!.body).toBe("# Old");
      expect(doc!.title).toBe("New");
      expect(doc!.frontmatter).toEqual({ tags: ["a"] });
      expect(getPaneIds("new.md")).toEqual(["p1"]);
    });

    it("no-op when old path is missing (does not throw)", () => {
      expect(() => renamePath("missing.md", "new.md", { title: "New" })).not.toThrow();
      expect(getDoc("new.md")).toBeNull();
    });

    it("no-op when oldPath equals newPath", () => {
      acquire("same.md", "p1");
      setContent("same.md", { body: "b", title: "T", frontmatter: {}, rawYaml: "" });

      renamePath("same.md", "same.md", { title: "Changed" });

      const doc = getDoc("same.md");
      expect(doc).not.toBeNull();
      expect(doc!.title).toBe("T");
      expect(doc!.body).toBe("b");
    });

    it("without a patch the doc keeps its original title", () => {
      acquire("old.md", "p1");
      setContent("old.md", { body: "b", title: "Old", frontmatter: {}, rawYaml: "" });

      renamePath("old.md", "new.md");

      expect(getDoc("old.md")).toBeNull();
      expect(getDoc("new.md")!.title).toBe("Old");
    });

    it("renamePath with pending debounce writes only the new path", async () => {
      acquire("old.md", "p1");
      setContent("old.md", {
        body: "original",
        title: "Old",
        frontmatter: { tags: ["a"] },
        rawYaml: "tags:\n  - a\n",
      });
      setBody("old.md", "edited", "p1");

      expect(writePage).not.toHaveBeenCalled();

      renamePath("old.md", "new.md", { title: "New" });

      vi.advanceTimersByTime(300);
      await vi.advanceTimersByTimeAsync(0);

      expect(writePage).toHaveBeenCalledOnce();
      expect(writePage).toHaveBeenCalledWith("new.md", "edited", { tags: ["a"] });
      const calls = vi.mocked(writePage).mock.calls;
      expect(calls.every(([path]) => path !== "old.md")).toBe(true);

      expect(getDoc("old.md")).toBeNull();
      const doc = getDoc("new.md");
      expect(doc).not.toBeNull();
      expect(doc!.body).toBe("edited");
      expect(doc!.title).toBe("New");
    });

    it("renamePath on clean doc does not schedule a save", async () => {
      acquire("old.md", "p1");
      setContent("old.md", {
        body: "clean",
        title: "Old",
        frontmatter: {},
        rawYaml: "",
      });

      renamePath("old.md", "new.md");

      vi.advanceTimersByTime(300);
      await vi.advanceTimersByTimeAsync(0);

      expect(writePage).not.toHaveBeenCalled();
    });

    it("renamePath during in-flight save follows up on the new path if still dirty", async () => {
      let resolveWrite!: () => void;
      vi.mocked(writePage).mockImplementation(
        () => new Promise<void>((r) => { resolveWrite = r; }),
      );

      acquire("old.md", "p1");
      setContent("old.md", {
        body: "v0",
        title: "Old",
        frontmatter: { tags: ["a"] },
        rawYaml: "tags:\n  - a\n",
      });

      // First write goes in flight on the old path (pre-rename flight is
      // unavoidable - the timer was armed before the rename).
      setBody("old.md", "v1", "p1");
      vi.advanceTimersByTime(300);
      expect(writePage).toHaveBeenCalledOnce();
      expect(writePage).toHaveBeenCalledWith("old.md", "v1", { tags: ["a"] });

      // Edit while in flight, then rename.
      setBody("old.md", "v2", "p1");
      renamePath("old.md", "new.md", { title: "New" });

      // Settle the first write; the follow-up must target the new path.
      resolveWrite();
      await vi.advanceTimersByTimeAsync(0);
      vi.advanceTimersByTime(300);
      await vi.advanceTimersByTimeAsync(0);

      // The follow-up write (new.md) is also deferred - settle it so the doc
      // ends clean.
      resolveWrite();
      await vi.advanceTimersByTimeAsync(0);

      const calls = vi.mocked(writePage).mock.calls;
      expect(calls.some(([path, body]) => path === "new.md" && body === "v2")).toBe(true);
      expect(isDirty("new.md")).toBe(false);
      expect(getDoc("old.md")).toBeNull();
      expect(getDoc("new.md")!.body).toBe("v2");
      expect(getDoc("new.md")!.title).toBe("New");
    });
  });

  describe("flushSave", () => {
    it("flushSave awaits pending debounce and writes immediately", async () => {
      // The previous test left a deferred implementation on the shared mock;
      // restore the immediate-resolve default so flushSave can settle.
      vi.mocked(writePage).mockImplementation(() => Promise.resolve());

      acquire("notes.md", "p1");
      setContent("notes.md", {
        body: "old",
        title: "T",
        frontmatter: { tags: ["a"] },
        rawYaml: "",
      });
      setBody("notes.md", "edited", "p1");

      expect(writePage).not.toHaveBeenCalled();

      await flushSave("notes.md");

      expect(writePage).toHaveBeenCalledOnce();
      expect(writePage).toHaveBeenCalledWith("notes.md", "edited", { tags: ["a"] });
      expect(isDirty("notes.md")).toBe(false);
    });

    it("flushSave is a no-op for missing docs", async () => {
      await expect(flushSave("missing.md")).resolves.toBeUndefined();
      expect(writePage).not.toHaveBeenCalled();
    });

    it("flushSave is a no-op for clean docs", async () => {
      acquire("notes.md", "p1");
      setContent("notes.md", {
        body: "clean",
        title: "T",
        frontmatter: {},
        rawYaml: "",
      });

      await flushSave("notes.md");

      expect(writePage).not.toHaveBeenCalled();
      expect(isDirty("notes.md")).toBe(false);
    });
  });

  describe("misc", () => {
    it("_resetForTesting prevents stale maybeDelete from deleting a re-acquired doc", async () => {
      acquire("notes.md", "p1");
      setContent("notes.md", { body: "old", title: "T", frontmatter: {}, rawYaml: "" });
      setBody("notes.md", "edited", "p1");

      let resolveWrite!: () => void;
      vi.mocked(writePage).mockImplementationOnce(
        () => new Promise<void>((r) => { resolveWrite = r; }),
      );

      // Release queues a save + maybeDelete chain.
      release("notes.md", "p1");

      // Full reset — simulates a test boundary.
      _resetForTesting();

      // Re-acquire the same path with fresh content.
      acquire("notes.md", "p2");
      setContent("notes.md", { body: "fresh", title: "T2", frontmatter: {}, rawYaml: "" });

      // Settle the old write — stale maybeDelete must NOT delete the new doc.
      resolveWrite();
      await vi.advanceTimersByTimeAsync(0);

      const doc = getDoc("notes.md");
      expect(doc).not.toBeNull();
      expect(doc!.body).toBe("fresh");
    });

    it("_resetForTesting clears all state", () => {
      acquire("a.md", "p1");
      acquire("b.md", "p2");
      _resetForTesting();
      expect(getDoc("a.md")).toBeNull();
      expect(getDoc("b.md")).toBeNull();
    });
  });

  describe("loaded flag", () => {
    it("getDoc after acquire has loaded === false", () => {
      acquire("notes.md", "p1");
      const doc = getDoc("notes.md");
      expect(doc!.loaded).toBe(false);
    });

    it("setContent sets loaded = true", () => {
      acquire("notes.md", "p1");
      setContent("notes.md", {
        body: "# Hello",
        title: "Hello",
        frontmatter: {},
        rawYaml: "",
      });
      const doc = getDoc("notes.md");
      expect(doc!.loaded).toBe(true);
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

  describe("reload coordination", () => {
    it("startReload returns true first call, false while in flight", () => {
      acquire("notes.md", "p1");
      expect(startReload("notes.md")).toBe(true);
      expect(startReload("notes.md")).toBe(false);
    });

    it("finishReload clears flag, updates content, notifies content-reload subscribers (not fromPaneId)", () => {
      acquire("notes.md", "p1");
      acquire("notes.md", "p2");
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      subscribeContentReload("notes.md", "p1", cb1);
      subscribeContentReload("notes.md", "p2", cb2);

      expect(startReload("notes.md")).toBe(true);
      const content = { body: "reloaded", title: "R", frontmatter: {}, rawYaml: "" };
      finishReload("notes.md", content, "p1");

      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledWith(content);

      expect(startReload("notes.md")).toBe(true);
      expect(getDoc("notes.md")!.body).toBe("reloaded");
    });

    it("cancelReload clears the in-flight flag without notifying", () => {
      acquire("notes.md", "p1");
      const cb = vi.fn();
      subscribeContentReload("notes.md", "p1", cb);

      expect(startReload("notes.md")).toBe(true);
      cancelReload("notes.md");
      expect(cb).not.toHaveBeenCalled();
      expect(startReload("notes.md")).toBe(true);
    });

    it("release removes content-reload subscriber", () => {
      acquire("notes.md", "p1");
      acquire("notes.md", "p2");
      const cb = vi.fn();
      subscribeContentReload("notes.md", "p1", cb);

      release("notes.md", "p1");

      startReload("notes.md");
      finishReload("notes.md", { body: "new", title: "N", frontmatter: {}, rawYaml: "" }, "p2");
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("subscribeSaveSettled", () => {
    it("calls back with isDirty=false after successful save", async () => {
      let resolveWrite!: () => void;
      vi.mocked(writePage).mockImplementation(
        () => new Promise<void>((r) => { resolveWrite = r; }),
      );

      acquire("notes.md", "p1");
      setContent("notes.md", { body: "", title: "T", frontmatter: {}, rawYaml: "" });

      const cb = vi.fn();
      subscribeSaveSettled("notes.md", "p1", cb);

      setBody("notes.md", "edited", "p1");
      expect(cb).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      resolveWrite();
      await vi.advanceTimersByTimeAsync(0);

      expect(cb).toHaveBeenCalledOnce();
      expect(cb).toHaveBeenCalledWith(false);
    });

    it("calls back with isDirty=true when edit happens during save flight", async () => {
      let resolveWrite!: () => void;
      vi.mocked(writePage).mockImplementation(
        () => new Promise<void>((r) => { resolveWrite = r; }),
      );

      acquire("notes.md", "p1");
      setContent("notes.md", { body: "", title: "T", frontmatter: {}, rawYaml: "" });

      const cb = vi.fn();
      subscribeSaveSettled("notes.md", "p1", cb);

      setBody("notes.md", "v1", "p1");
      vi.advanceTimersByTime(300);

      setBody("notes.md", "v2", "p1");

      resolveWrite();
      await vi.advanceTimersByTimeAsync(0);

      expect(cb).toHaveBeenCalledOnce();
      expect(cb).toHaveBeenCalledWith(true);
    });

    it("release removes save-settled subscriber", async () => {
      acquire("notes.md", "p1");
      setContent("notes.md", { body: "", title: "T", frontmatter: {}, rawYaml: "" });

      const cb = vi.fn();
      subscribeSaveSettled("notes.md", "p1", cb);

      release("notes.md", "p1");

      // Re-acquire so we can trigger a save cycle
      acquire("notes.md", "p2");
      setContent("notes.md", { body: "", title: "T", frontmatter: {}, rawYaml: "" });
      setBody("notes.md", "edited", "p2");
      vi.advanceTimersByTime(300);
      await vi.advanceTimersByTimeAsync(0);

      expect(cb).not.toHaveBeenCalled();
    });
  });
});

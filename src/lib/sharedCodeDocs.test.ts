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
  setBody,
  isDirty,
  isShared,
  _resetForTesting,
} from "./sharedCodeDocs";
import { writeCodeFile } from "./ipc";

vi.mock("./ipc", () => ({
  writeCodeFile: vi.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  vi.useFakeTimers();
  _resetForTesting();
  vi.mocked(writeCodeFile).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SharedCodeDocRegistry", () => {
  it("acquire registers a pane and getPaneIds returns it", () => {
    acquire("refs.bib", "p1");
    expect(getPaneIds("refs.bib")).toEqual(["p1"]);
  });

  it("getDoc returns a doc after acquire and null otherwise", () => {
    acquire("refs.bib", "p1");
    expect(getDoc("refs.bib")).not.toBeNull();
    expect(getDoc("other.bib")).toBeNull();
  });

  it("setBody schedules a debounced save calling writeCodeFile with (path, body) only", () => {
    acquire("refs.bib", "p1");
    setContent("refs.bib", { body: "old", title: "refs" });
    setBody("refs.bib", "new body", "p1");

    expect(writeCodeFile).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(writeCodeFile).toHaveBeenCalledOnce();
    expect(writeCodeFile).toHaveBeenCalledWith("refs.bib", "new body");
    // Exactly two args — no frontmatter.
    expect(vi.mocked(writeCodeFile).mock.calls[0]).toHaveLength(2);
  });

  it("collapses two rapid edits into one save with the latest body", () => {
    acquire("refs.bib", "p1");
    setContent("refs.bib", { body: "", title: "T" });
    setBody("refs.bib", "first", "p1");
    vi.advanceTimersByTime(100);
    setBody("refs.bib", "second", "p1");
    vi.advanceTimersByTime(300);

    expect(writeCodeFile).toHaveBeenCalledOnce();
    expect(writeCodeFile).toHaveBeenCalledWith("refs.bib", "second");
  });

  it("release of the last pane with pending edits flushes immediately", async () => {
    acquire("refs.bib", "p1");
    setContent("refs.bib", { body: "", title: "T" });
    setBody("refs.bib", "unsaved", "p1");
    expect(writeCodeFile).not.toHaveBeenCalled();

    release("refs.bib", "p1");
    expect(writeCodeFile).toHaveBeenCalledOnce();
    expect(writeCodeFile).toHaveBeenCalledWith("refs.bib", "unsaved");

    // Happy path with the default immediately-resolving mock: once the
    // in-flight save settles, the abandoned doc is GC'd from the registry.
    await vi.advanceTimersByTimeAsync(0);
    expect(getDoc("refs.bib")).toBeNull();
  });

  it("release with in-flight save defers delete; re-acquire reuses the edited in-memory body", async () => {
    acquire("refs.bib", "p1");
    setContent("refs.bib", { body: "old", title: "T" });
    setBody("refs.bib", "edited", "p1");

    // Manually-controlled deferred write so we can observe the in-flight window.
    let resolveWrite!: () => void;
    vi.mocked(writeCodeFile).mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolveWrite = () => r();
        }),
    );

    release("refs.bib", "p1");
    expect(writeCodeFile).toHaveBeenCalledWith("refs.bib", "edited");

    // Doc must NOT be deleted while the save is still in flight.
    expect(getDoc("refs.bib")).not.toBeNull();

    // Re-open the same file before the write lands.
    acquire("refs.bib", "p2");
    const doc = getDoc("refs.bib");
    expect(doc).not.toBeNull();
    // Reused in-memory doc, not a fresh empty one.
    expect(doc!.loaded).toBe(true);
    expect(doc!.body).toBe("edited");

    // Let the save .then run; doc stays because p2 holds it.
    resolveWrite();
    await vi.advanceTimersByTimeAsync(0);
    expect(getDoc("refs.bib")).not.toBeNull();
    expect(getDoc("refs.bib")!.body).toBe("edited");
  });

  it("release with in-flight save (no new edits since save started) defers delete until save settles", async () => {
    acquire("refs.bib", "p1");
    setContent("refs.bib", { body: "old", title: "T" });
    setBody("refs.bib", "edited", "p1");

    let resolveWrite!: () => void;
    vi.mocked(writeCodeFile).mockImplementationOnce(
      () => new Promise<void>((r) => { resolveWrite = r; }),
    );

    // Fire the debounce timer — starts the save (saveInFlightGen becomes 1).
    vi.advanceTimersByTime(300);
    expect(writeCodeFile).toHaveBeenCalledOnce();

    // Release with no new edits since the save started (Branch 2).
    release("refs.bib", "p1");
    // Doc must NOT be deleted while the save is still in flight.
    expect(getDoc("refs.bib")).not.toBeNull();

    // Settle the write — now the deferred maybeDelete runs.
    resolveWrite();
    await vi.advanceTimersByTimeAsync(0);
    expect(getDoc("refs.bib")).toBeNull();
  });

  it("release with in-flight save (no new edits) allows re-acquire to reuse in-memory doc", async () => {
    acquire("refs.bib", "p1");
    setContent("refs.bib", { body: "old", title: "T" });
    setBody("refs.bib", "edited", "p1");

    let resolveWrite!: () => void;
    vi.mocked(writeCodeFile).mockImplementationOnce(
      () => new Promise<void>((r) => { resolveWrite = r; }),
    );

    vi.advanceTimersByTime(300);
    release("refs.bib", "p1");

    // Re-acquire before the save settles.
    acquire("refs.bib", "p2");
    const doc = getDoc("refs.bib");
    expect(doc).not.toBeNull();
    expect(doc!.loaded).toBe(true);
    expect(doc!.body).toBe("edited");

    // Settle the write — doc survives because p2 holds it.
    resolveWrite();
    await vi.advanceTimersByTimeAsync(0);
    expect(getDoc("refs.bib")).not.toBeNull();
    expect(getDoc("refs.bib")!.body).toBe("edited");
  });

  it("deferred delete still collects the entry once truly idle (reopen then close)", async () => {
    acquire("refs.bib", "p1");
    setContent("refs.bib", { body: "old", title: "T" });
    setBody("refs.bib", "edited", "p1");

    let resolveWrite!: () => void;
    vi.mocked(writeCodeFile).mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolveWrite = () => r();
        }),
    );

    release("refs.bib", "p1");
    acquire("refs.bib", "p2");
    resolveWrite();
    await vi.advanceTimersByTimeAsync(0);
    expect(getDoc("refs.bib")).not.toBeNull();

    // Close p2 with no new edits — entry should be collected.
    release("refs.bib", "p2");
    await vi.advanceTimersByTimeAsync(0);
    expect(getDoc("refs.bib")).toBeNull();
  });

  it("setBody notifies sibling panes but not the originating pane", () => {
    acquire("refs.bib", "p1");
    acquire("refs.bib", "p2");
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    subscribe("refs.bib", "p1", cb1);
    subscribe("refs.bib", "p2", cb2);

    setBody("refs.bib", "edited", "p2");
    expect(cb1).toHaveBeenCalledWith("edited", "p2");
    expect(cb2).not.toHaveBeenCalled();
  });

  it("isDirty is true after edit and false after save settles", async () => {
    acquire("refs.bib", "p1");
    setContent("refs.bib", { body: "", title: "T" });
    expect(isDirty("refs.bib")).toBe(false);

    setBody("refs.bib", "edited", "p1");
    expect(isDirty("refs.bib")).toBe(true);

    vi.advanceTimersByTime(300);
    await vi.advanceTimersByTimeAsync(0);
    expect(isDirty("refs.bib")).toBe(false);
  });

  it("isShared reflects pane count", () => {
    acquire("refs.bib", "p1");
    expect(isShared("refs.bib")).toBe(false);
    acquire("refs.bib", "p2");
    expect(isShared("refs.bib")).toBe(true);
  });

  it("finishReload pushes content to content-reload subscribers except fromPaneId", () => {
    acquire("refs.bib", "p1");
    acquire("refs.bib", "p2");
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    subscribeContentReload("refs.bib", "p1", cb1);
    subscribeContentReload("refs.bib", "p2", cb2);

    expect(startReload("refs.bib")).toBe(true);
    const content = { body: "reloaded", title: "R" };
    finishReload("refs.bib", content, "p1");

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledWith(content);
    expect(getDoc("refs.bib")!.body).toBe("reloaded");
  });

  it("subscribeSaveSettled fires with false after a successful save", async () => {
    acquire("refs.bib", "p1");
    setContent("refs.bib", { body: "", title: "T" });
    const cb = vi.fn();
    subscribeSaveSettled("refs.bib", "p1", cb);

    setBody("refs.bib", "edited", "p1");
    vi.advanceTimersByTime(300);
    await vi.advanceTimersByTimeAsync(0);

    expect(cb).toHaveBeenCalledWith(false);
  });

  it("_resetForTesting prevents stale maybeDelete from deleting a re-acquired doc", async () => {
    acquire("refs.bib", "p1");
    setContent("refs.bib", { body: "old", title: "T" });
    setBody("refs.bib", "edited", "p1");

    let resolveWrite!: () => void;
    vi.mocked(writeCodeFile).mockImplementationOnce(
      () => new Promise<void>((r) => { resolveWrite = r; }),
    );

    // Release queues a save + maybeDelete chain.
    release("refs.bib", "p1");

    // Full reset — simulates a test boundary.
    _resetForTesting();

    // Re-acquire the same path with fresh content.
    acquire("refs.bib", "p2");
    setContent("refs.bib", { body: "fresh", title: "T2" });

    // Settle the old write — stale maybeDelete must NOT delete the new doc.
    resolveWrite();
    await vi.advanceTimersByTimeAsync(0);

    const doc = getDoc("refs.bib");
    expect(doc).not.toBeNull();
    expect(doc!.body).toBe("fresh");
  });

  it("is isolated from the markdown shared-docs registry", () => {
    // A separate module-level Map: nothing leaks across after reset.
    acquire("refs.bib", "p1");
    _resetForTesting();
    expect(getDoc("refs.bib")).toBeNull();
  });
});

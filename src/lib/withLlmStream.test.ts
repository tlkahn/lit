import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Annotation } from "./ipc";
import { useModalLockStore } from "../stores/modalLock";
import { useStatusMessageStore } from "../stores/statusMessage";
import { useSecretStoreStore } from "../stores/secretStore";
import { firingAnnotationsField, firingRangeField, clearFiringAnnotation } from "../editor/livePreview/annotationWidgets";

vi.mock("./ipc", () => ({
  resolveAnnotationScopeWithMode: vi.fn(async () => null),
  secretStoreStatus: vi.fn(async () => ({ exists: true, unlocked: false, needsMigration: true })),
  autoUnlockSecretStore: vi.fn(async () => false),
}));

vi.mock("./llmClient", () => ({
  startLlmStream: vi.fn(async () => {}),
  cancelLlmStream: vi.fn(async () => {}),
}));

import { startLlmStream, cancelLlmStream } from "./llmClient";
import { withLlmStream } from "./withLlmStream";

const mockStream = startLlmStream as ReturnType<typeof vi.fn>;
const mockCancel = cancelLlmStream as ReturnType<typeof vi.fn>;

const flush = (n = 5) =>
  Array.from({ length: n }).reduce<Promise<void>>(
    (p) => p.then(() => new Promise((r) => queueMicrotask(r))),
    Promise.resolve(),
  );

function makeView(doc = "hello world"): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, extensions: [firingAnnotationsField, firingRangeField] }),
    parent: document.createElement("div"),
  });
}

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    form: "compact",
    annotation_type: "llm",
    certainty: "neutral",
    scope: { kind: "sentence", value: 1 },
    body: "explain this",
    date: null,
    is_structured: true,
    char_start: 0,
    char_end: 11,
    original: "<!--- llm | explain this --->",
    ...overrides,
  };
}

const STREAM_ARGS = { model: "m", text: "hi", system: undefined };

beforeEach(() => {
  vi.clearAllMocks();
  useModalLockStore.setState({ llmLocked: false, openCount: 0, locked: false });
  useStatusMessageStore.setState({ message: null, variant: "success" });
  useSecretStoreStore.getState()._resetSettler();
  useSecretStoreStore.setState({ exists: true, unlocked: true, loading: false, migrationPromptOpen: false });
});

afterEach(() => {
  window.dispatchEvent(new CustomEvent("lit:cancel-fire"));
  mockStream.mockImplementation(async () => {});
});

describe("withLlmStream", () => {
  it("throws when already llmLocked and does not stream", async () => {
    useModalLockStore.setState({ llmLocked: true });
    const view = makeView();

    await expect(
      withLlmStream(view, makeAnnotation(), {
        buildArgs: async () => STREAM_ARGS,
        onDone: () => {},
      }),
    ).rejects.toThrow("LLM is already streaming");

    expect(mockStream).not.toHaveBeenCalled();
    view.destroy();
  });

  it("sets lock + firing spinner + dispatches lit:fire-started before streaming", async () => {
    let lockedDuringCall = false;
    let firingDuringCall = false;
    let startedDuringCall = false;
    const startedSpy = vi.fn(() => {
      startedDuringCall = true;
    });
    window.addEventListener("lit:fire-started", startedSpy);
    mockStream.mockImplementation(async () => {
      lockedDuringCall = useModalLockStore.getState().llmLocked;
      firingDuringCall = view.state.field(firingAnnotationsField).has(0);
    });
    const view = makeView();

    await withLlmStream(view, makeAnnotation({ char_start: 0 }), {
      buildArgs: async () => STREAM_ARGS,
      onDone: () => {},
    });

    expect(lockedDuringCall).toBe(true);
    expect(firingDuringCall).toBe(true);
    expect(startedDuringCall).toBe(true);
    window.removeEventListener("lit:fire-started", startedSpy);
    view.destroy();
  });

  it("releases the lock and clears the spinner on stream error", async () => {
    mockStream.mockImplementation(async (_args: unknown, cb: { onError: (e: { message: string; retryable: boolean }) => void }) => {
      cb.onError({ message: "API down", retryable: false });
    });
    const view = makeView();

    await withLlmStream(view, makeAnnotation({ char_start: 0 }), {
      buildArgs: async () => STREAM_ARGS,
      onDone: () => {},
    });

    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(view.state.field(firingAnnotationsField).size).toBe(0);
    expect(useStatusMessageStore.getState().message).toBe("API down");
    expect(useStatusMessageStore.getState().variant).toBe("error");
    view.destroy();
  });

  it("releases the lock on synchronous stream throw", async () => {
    mockStream.mockImplementation(async () => {
      throw new Error("boom");
    });
    const view = makeView();

    await withLlmStream(view, makeAnnotation({ char_start: 0 }), {
      buildArgs: async () => STREAM_ARGS,
      onDone: () => {},
    });

    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(useStatusMessageStore.getState().message).toBe("boom");
    expect(useStatusMessageStore.getState().variant).toBe("error");
    view.destroy();
  });

  it("lit:cancel-fire calls cancelLlmStream, unlocks, clears spinner, and short-circuits before stream", async () => {
    mockStream.mockImplementation(() => new Promise(() => {}));
    let resolveBuild: (v: typeof STREAM_ARGS) => void = () => {};
    const buildGate = new Promise<typeof STREAM_ARGS>((r) => {
      resolveBuild = r;
    });
    const view = makeView();

    const promise = withLlmStream(view, makeAnnotation({ char_start: 0 }), {
      buildArgs: async () => buildGate,
      onDone: () => {},
    });
    await flush();

    expect(useModalLockStore.getState().llmLocked).toBe(true);
    expect(view.state.field(firingAnnotationsField).has(0)).toBe(true);

    window.dispatchEvent(new CustomEvent("lit:cancel-fire"));
    await flush();

    expect(mockCancel).toHaveBeenCalledOnce();
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(view.state.field(firingAnnotationsField).has(0)).toBe(false);

    // Even if buildArgs later resolves, the stream must not start.
    resolveBuild(STREAM_ARGS);
    await flush();
    expect(mockStream).not.toHaveBeenCalled();

    view.destroy();
    void promise;
  });

  it("buildArgs returning null aborts cleanly (cleanup runs, no stream)", async () => {
    const completeSpy = vi.fn();
    window.addEventListener("lit:fire-complete", completeSpy);
    const view = makeView();

    await withLlmStream(view, makeAnnotation({ char_start: 0 }), {
      buildArgs: async () => null,
      onDone: () => {},
    });

    expect(mockStream).not.toHaveBeenCalled();
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(view.state.field(firingAnnotationsField).has(0)).toBe(false);
    expect(completeSpy).toHaveBeenCalledOnce();
    window.removeEventListener("lit:fire-complete", completeSpy);
    view.destroy();
  });

  it("onDone receives accumulated responseText and markFiringCleared suppresses the fallback clear", async () => {
    let seenResponse = "";
    mockStream.mockImplementation(async (_args: unknown, cb: { onChunk: (t: string) => void; onDone: () => void }) => {
      cb.onChunk("a");
      cb.onChunk("b");
      cb.onDone();
    });
    const view = makeView();

    await withLlmStream(view, makeAnnotation({ char_start: 0 }), {
      buildArgs: async () => STREAM_ARGS,
      onDone: ({ responseText, markFiringCleared }) => {
        seenResponse = responseText;
        // Simulate the call-site clearing the firing entry in its own transaction.
        view.dispatch({ effects: clearFiringAnnotation.of(0) });
        markFiringCleared();
      },
    });

    expect(seenResponse).toBe("ab");
    expect(view.state.field(firingAnnotationsField).size).toBe(0);
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    view.destroy();
  });

  it("sets firingRangeField during streaming", async () => {
    let rangeDuringStream: { from: number; to: number } | null = null;
    mockStream.mockImplementation(async () => {
      rangeDuringStream = view.state.field(firingRangeField);
    });
    const view = makeView();

    await withLlmStream(view, makeAnnotation({ char_start: 0, char_end: 11 }), {
      buildArgs: async () => STREAM_ARGS,
      onDone: () => {},
    });

    expect(rangeDuringStream).toEqual({ from: 0, to: 11 });
    view.destroy();
  });

  it("clears firingRangeField after buildArgs returns null", async () => {
    const view = makeView();

    await withLlmStream(view, makeAnnotation({ char_start: 0, char_end: 11 }), {
      buildArgs: async () => null,
      onDone: () => {},
    });

    expect(view.state.field(firingRangeField)).toBeNull();
    view.destroy();
  });

  it("clears firingRangeField after cancel", async () => {
    mockStream.mockImplementation(() => new Promise(() => {}));
    let resolveBuild: (v: typeof STREAM_ARGS) => void = () => {};
    const buildGate = new Promise<typeof STREAM_ARGS>((r) => {
      resolveBuild = r;
    });
    const view = makeView();

    const promise = withLlmStream(view, makeAnnotation({ char_start: 0, char_end: 11 }), {
      buildArgs: async () => buildGate,
      onDone: () => {},
    });
    await flush();

    window.dispatchEvent(new CustomEvent("lit:cancel-fire"));
    await flush();

    expect(view.state.field(firingRangeField)).toBeNull();

    resolveBuild(STREAM_ARGS);
    await flush();
    view.destroy();
    void promise;
  });

  it("onDone receives liveRange matching the current firingRangeField value", async () => {
    let receivedRange: { from: number; to: number } | null = null;
    mockStream.mockImplementation(async (_args: unknown, cb: { onChunk: (t: string) => void; onDone: () => void }) => {
      cb.onChunk("x");
      cb.onDone();
    });
    const view = makeView();

    await withLlmStream(view, makeAnnotation({ char_start: 0, char_end: 11 }), {
      buildArgs: async () => STREAM_ARGS,
      onDone: ({ liveRange }) => {
        receivedRange = liveRange;
      },
    });

    expect(receivedRange).toEqual({ from: 0, to: 11 });
    view.destroy();
  });

  it("doCleanup uses live start position after mid-stream edit (no ghost spinner)", async () => {
    mockStream.mockImplementation(async (_args: unknown, cb: { onError: (e: { message: string; retryable: boolean }) => void }) => {
      // Simulate user edit: insert "XX" at position 0 before the annotation.
      // This shifts the firing annotation from pos 0 to pos 2.
      view.dispatch({ changes: { from: 0, to: 0, insert: "XX" } });
      cb.onError({ message: "fail", retryable: false });
    });
    const view = makeView();

    await withLlmStream(view, makeAnnotation({ char_start: 0, char_end: 11 }), {
      buildArgs: async () => STREAM_ARGS,
      onDone: () => {},
    });

    // The firing set should be empty — the live position (2) was used for the clear.
    expect(view.state.field(firingAnnotationsField).size).toBe(0);
    view.destroy();
  });

  it("ensureUnlocked rejection cleans up and does not stream", async () => {
    useSecretStoreStore.setState({ exists: true, unlocked: false });
    const completeSpy = vi.fn();
    window.addEventListener("lit:fire-complete", completeSpy);
    const view = makeView();

    const promise = withLlmStream(view, makeAnnotation({ char_start: 0 }), {
      buildArgs: async () => STREAM_ARGS,
      onDone: () => {},
    });
    await flush();

    expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(true);
    useSecretStoreStore.getState().settleMigration(false);
    await promise;

    expect(mockStream).not.toHaveBeenCalled();
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(view.state.field(firingAnnotationsField).has(0)).toBe(false);
    expect(completeSpy).toHaveBeenCalledOnce();
    window.removeEventListener("lit:fire-complete", completeSpy);
    view.destroy();
  });
});

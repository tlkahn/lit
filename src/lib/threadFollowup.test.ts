import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Annotation } from "./ipc";
import { useModalLockStore } from "../stores/modalLock";
import { usePreferencesStore } from "../stores/preferences";
import { useStatusMessageStore } from "../stores/statusMessage";
import { useSecretStoreStore } from "../stores/secretStore";
import { firingAnnotationsField, firingRangeField, threadTurnField } from "../editor/livePreview/annotationWidgets";
import { parseThreadBody } from "./threadBody";

vi.mock("./ipc", () => ({
  resolveAnnotationScopeWithMode: vi.fn(async () => null),
  secretStoreStatus: vi.fn(async () => ({ exists: true, unlocked: false })),
}));

vi.mock("./llmClient", () => ({
  startLlmStream: vi.fn(async () => {}),
  cancelLlmStream: vi.fn(async () => {}),
}));

import { startLlmStream, cancelLlmStream } from "./llmClient";
import { resolveAnnotationScopeWithMode } from "./ipc";
import { threadFollowup } from "./threadFollowup";

const mockStream = startLlmStream as ReturnType<typeof vi.fn>;
const mockCancel = cancelLlmStream as ReturnType<typeof vi.fn>;
const mockResolveScope = resolveAnnotationScopeWithMode as ReturnType<typeof vi.fn>;

const flush = (n = 5) =>
  Array.from({ length: n }).reduce<Promise<void>>(
    (p) => p.then(() => new Promise((r) => queueMicrotask(r))),
    Promise.resolve(),
  );

function makeView(doc: string): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [firingAnnotationsField, firingRangeField, threadTurnField],
    }),
    parent: document.createElement("div"),
  });
}

// A thread DSL block with two turns. The surrounding prefix/suffix lets us
// assert the rest of the document survives the in-place replace.
const PREFIX = "before text\n";
const SUFFIX = "\nafter text";
const THREAD_BODY = "[q]: A\n\nrespA\n\n[q]: B\n\nrespB";
const THREAD_DSL = `<!---[abc-123]\nth\n\\p\n---\n${THREAD_BODY}\n--->`;
const DOC = PREFIX + THREAD_DSL + SUFFIX;
const THREAD_START = PREFIX.length;
const THREAD_END = PREFIX.length + THREAD_DSL.length;

function makeThreadAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    form: "block",
    annotation_type: "thread",
    certainty: "neutral",
    scope: { kind: "sentence", value: 1 },
    body: THREAD_BODY,
    date: null,
    is_structured: true,
    char_start: THREAD_START,
    char_end: THREAD_END,
    original: THREAD_DSL,
    uuid: "abc-123",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useModalLockStore.setState({ llmLocked: false, openCount: 0, locked: false });
  useStatusMessageStore.setState({ message: null, variant: "success" });
  useSecretStoreStore.getState()._resetSettler();
  useSecretStoreStore.setState({ exists: true, unlocked: true, loading: false, promptOpen: false });
});

afterEach(() => {
  // Drain any lit:cancel-fire listeners leaked by never-resolving stream mocks.
  window.dispatchEvent(new CustomEvent("lit:cancel-fire"));
  mockStream.mockImplementation(async () => {});
});

describe("threadFollowup", () => {
  it("rejects when already llmLocked and does not stream", async () => {
    useModalLockStore.setState({ llmLocked: true });
    const view = makeView(DOC);

    await expect(
      threadFollowup({ view, annotation: makeThreadAnnotation(), question: "C" }),
    ).rejects.toThrow("LLM is already streaming");

    expect(mockStream).not.toHaveBeenCalled();
    view.destroy();
  });

  it("sends existing turns plus the follow-up as the messages array", async () => {
    const view = makeView(DOC);

    await threadFollowup({ view, annotation: makeThreadAnnotation(), question: "C" });

    const [streamArgs] = mockStream.mock.calls[0]!;
    expect(streamArgs.messages).toEqual([
      { role: "user", content: "A" },
      { role: "assistant", content: "respA" },
      { role: "user", content: "B" },
      { role: "assistant", content: "respB" },
      { role: "user", content: "C" },
    ]);
    view.destroy();
  });

  it("passes empty text (backend uses messages when present)", async () => {
    const view = makeView(DOC);

    await threadFollowup({ view, annotation: makeThreadAnnotation(), question: "C" });

    const [streamArgs] = mockStream.mock.calls[0]!;
    expect(streamArgs.text).toBe("");
    view.destroy();
  });

  it("uses llmPromptQ as the system prompt fallback for thread type", async () => {
    usePreferencesStore.setState({ llmPromptQ: "Conversational fallback" });
    const view = makeView(DOC);

    await threadFollowup({ view, annotation: makeThreadAnnotation(), question: "C" });

    const [streamArgs] = mockStream.mock.calls[0]!;
    expect(streamArgs.system).toBe("Conversational fallback");
    view.destroy();
  });

  it("sets llmLocked true during streaming", async () => {
    let lockedDuringCall = false;
    mockStream.mockImplementation(async () => {
      lockedDuringCall = useModalLockStore.getState().llmLocked;
    });
    const view = makeView(DOC);

    await threadFollowup({ view, annotation: makeThreadAnnotation(), question: "C" });

    expect(lockedDuringCall).toBe(true);
    view.destroy();
  });

  it("sets the firing effect during streaming and clears it on done", async () => {
    let firingDuringStream = false;
    mockStream.mockImplementation(async (_a: unknown, cb: { onChunk: (t: string) => void; onDone: () => void }) => {
      firingDuringStream = view.state.field(firingAnnotationsField).has(THREAD_START);
      cb.onChunk("answer C");
      cb.onDone();
    });
    const view = makeView(DOC);

    await threadFollowup({ view, annotation: makeThreadAnnotation(), question: "C" });

    expect(firingDuringStream).toBe(true);
    expect(view.state.field(firingAnnotationsField).has(THREAD_START)).toBe(false);
    view.destroy();
  });

  it("onDone clears the firing entry after thread DSL regeneration (no ghost spinner)", async () => {
    mockStream.mockImplementation(async (_a: unknown, cb: { onChunk: (t: string) => void; onDone: () => void }) => {
      cb.onChunk("answer C");
      cb.onDone();
    });
    const view = makeView(DOC);

    await threadFollowup({ view, annotation: makeThreadAnnotation(), question: "C" });

    expect(view.state.field(firingAnnotationsField).size).toBe(0);
    view.destroy();
  });

  it("appends the new turn to the document on done", async () => {
    mockStream.mockImplementation(async (_a: unknown, cb: { onChunk: (t: string) => void; onDone: () => void }) => {
      cb.onChunk("answer C");
      cb.onDone();
    });
    const view = makeView(DOC);

    await threadFollowup({ view, annotation: makeThreadAnnotation(), question: "C" });

    const result = view.state.doc.toString();
    expect(result).toContain("[q]: C");
    expect(result).toContain("answer C");
    // Prior turns preserved.
    expect(result).toContain("[q]: A");
    expect(result).toContain("respB");
    // The old DSL is replaced (it no longer appears verbatim).
    expect(result).not.toContain(THREAD_DSL);
    // Surrounding doc text intact.
    expect(result.startsWith(PREFIX)).toBe(true);
    expect(result.endsWith(SUFFIX)).toBe(true);
    view.destroy();
  });

  it("sets the thread turn index to the new last turn on done", async () => {
    mockStream.mockImplementation(async (_a: unknown, cb: { onChunk: (t: string) => void; onDone: () => void }) => {
      cb.onChunk("answer C");
      cb.onDone();
    });
    const view = makeView(DOC);

    await threadFollowup({ view, annotation: makeThreadAnnotation(), question: "C" });

    const turnMap = view.state.field(threadTurnField);
    // 3 turns after append (A, B, C) -> last index is 2.
    expect(turnMap.get(THREAD_START)).toBe(2);
    view.destroy();
  });

  it("unlocks on done", async () => {
    mockStream.mockImplementation(async (_a: unknown, cb: { onDone: () => void }) => {
      cb.onDone();
    });
    const view = makeView(DOC);

    await threadFollowup({ view, annotation: makeThreadAnnotation(), question: "C" });

    expect(useModalLockStore.getState().llmLocked).toBe(false);
    view.destroy();
  });

  it("preserves existing turns and shows an error toast on stream error", async () => {
    mockStream.mockImplementation(async (_a: unknown, cb: { onError: (e: { message: string; retryable: boolean }) => void }) => {
      cb.onError({ message: "API down", retryable: false });
    });
    const view = makeView(DOC);

    await threadFollowup({ view, annotation: makeThreadAnnotation(), question: "C" });

    expect(view.state.doc.toString()).toBe(DOC);
    expect(useStatusMessageStore.getState().message).toBe("API down");
    expect(useStatusMessageStore.getState().variant).toBe("error");
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(view.state.field(firingAnnotationsField).has(THREAD_START)).toBe(false);
    view.destroy();
  });

  it("lit:cancel-fire calls cancelLlmStream and unlocks", async () => {
    mockStream.mockImplementation(() => new Promise(() => {}));
    const view = makeView(DOC);

    const promise = threadFollowup({ view, annotation: makeThreadAnnotation(), question: "C" });
    await flush();

    window.dispatchEvent(new CustomEvent("lit:cancel-fire"));
    await flush();

    expect(mockCancel).toHaveBeenCalledOnce();
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(view.state.field(firingAnnotationsField).has(THREAD_START)).toBe(false);
    view.destroy();
    void promise;
  });

  it("cancel during setup (before stream starts) releases the lock and clears the spinner", async () => {
    // Force the function to park on ensureUnlocked: locked store whose unlock
    // promise never settles (replicates the passphrase-modal window). Refresh
    // returns { unlocked: false } (mocked secretStoreStatus), so the prompt
    // opens and the pending promise never resolves during the test.
    useSecretStoreStore.getState()._resetSettler();
    useSecretStoreStore.setState({ exists: true, unlocked: false, promptOpen: false });
    // Safety net: if the stream were ever started, it must not resolve.
    mockStream.mockImplementation(() => new Promise(() => {}));
    const view = makeView(DOC);

    const promise = threadFollowup({ view, annotation: makeThreadAnnotation(), question: "C" });
    await flush(); // parked on ensureUnlocked: spinner shown, lock held

    // Sanity: mid-setup state.
    expect(useModalLockStore.getState().llmLocked).toBe(true);
    expect(view.state.field(firingAnnotationsField).has(THREAD_START)).toBe(true);

    window.dispatchEvent(new CustomEvent("lit:cancel-fire"));
    await flush();

    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(view.state.field(firingAnnotationsField).has(THREAD_START)).toBe(false);
    expect(mockCancel).toHaveBeenCalled();
    expect(mockStream).not.toHaveBeenCalled();

    view.destroy();
    void promise;
  });

  it("is a no-op for a whitespace-only question (does not stream or lock)", async () => {
    const view = makeView(DOC);

    await threadFollowup({ view, annotation: makeThreadAnnotation(), question: "   " });

    expect(mockStream).not.toHaveBeenCalled();
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(view.state.doc.toString()).toBe(DOC);
    view.destroy();
  });

  it("mid-stream edit: replacement targets shifted range and thread turn is keyed at live position", async () => {
    mockStream.mockImplementation(async (_a: unknown, cb: { onChunk: (t: string) => void; onDone: () => void }) => {
      // Simulate a user edit during streaming: insert "XXXX" before the thread.
      // This shifts the thread from THREAD_START to THREAD_START+4.
      view.dispatch({ changes: { from: 0, to: 0, insert: "XXXX" } });
      cb.onChunk("answer C");
      cb.onDone();
    });
    const view = makeView(DOC);

    await threadFollowup({ view, annotation: makeThreadAnnotation(), question: "C" });

    const result = view.state.doc.toString();
    // New turn should be present
    expect(result).toContain("[q]: C");
    expect(result).toContain("answer C");
    // "XXXX" prefix is intact
    expect(result.startsWith("XXXX")).toBe(true);
    // Old DSL is gone (replaced at shifted position)
    expect(result).not.toContain(THREAD_DSL);
    // Thread turn is keyed at the shifted position
    const turnMap = view.state.field(threadTurnField);
    expect(turnMap.get(THREAD_START + 4)).toBe(2);
    // No ghost spinner
    expect(view.state.field(firingAnnotationsField).size).toBe(0);
    view.destroy();
  });

  it("does not perform a scope-resolution IPC round-trip during follow-up", async () => {
    mockStream.mockImplementation(async (_a: unknown, cb: { onChunk: (t: string) => void; onDone: () => void }) => {
      cb.onChunk("answer C");
      cb.onDone();
    });
    const view = makeView(DOC);

    await threadFollowup({ view, annotation: makeThreadAnnotation(), question: "C" });

    expect(mockResolveScope).not.toHaveBeenCalled();
    view.destroy();
  });

  it("the appended turn is parseable as a new last turn", async () => {
    mockStream.mockImplementation(async (_a: unknown, cb: { onChunk: (t: string) => void; onDone: () => void }) => {
      cb.onChunk("answer C");
      cb.onDone();
    });
    const view = makeView(DOC);

    await threadFollowup({ view, annotation: makeThreadAnnotation(), question: "C" });

    const newDoc = view.state.doc.toString();
    const newDsl = newDoc.slice(THREAD_START, newDoc.length - SUFFIX.length);
    const bodyMatch = newDsl.match(/\n---\n([\s\S]*)\n--->$/);
    expect(bodyMatch).not.toBeNull();
    const turns = parseThreadBody(bodyMatch![1]!);
    expect(turns.length).toBe(3);
    expect(turns[2]).toEqual({ question: "C", response: "answer C" });
    view.destroy();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Annotation } from "./ipc";
import { useModalLockStore } from "../stores/modalLock";
import { usePreferencesStore } from "../stores/preferences";
import { useLlmResponseStore } from "../stores/llmResponse";
import { firingAnnotationsField } from "../editor/livePreview/annotationWidgets";

vi.mock("./ipc", () => ({
  resolveAnnotationScopeWithMode: vi.fn(async () => null),
}));

vi.mock("./llmClient", () => ({
  startLlmStream: vi.fn(async () => {}),
}));

import { resolveAnnotationScopeWithMode } from "./ipc";
import { startLlmStream } from "./llmClient";
import { fireAnnotation, buildFirePrompt, getTypePrompt } from "./fireOrchestrator";

const mockResolve = resolveAnnotationScopeWithMode as ReturnType<typeof vi.fn>;
const mockStream = startLlmStream as ReturnType<typeof vi.fn>;

function makeView(doc = "hello world", withFiringField = false): EditorView {
  const extensions = withFiringField ? [firingAnnotationsField] : [];
  return new EditorView({
    state: EditorState.create({ doc, extensions }),
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
    original: "%%! llm | explain this %%",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useModalLockStore.setState({ llmLocked: false, openCount: 0, locked: false });
  useLlmResponseStore.getState().reset();
});

describe("buildFirePrompt", () => {
  it("combines scope text and body", () => {
    expect(buildFirePrompt("context here", "explain")).toBe("context here\n\nexplain");
  });

  it("returns only body when scope text is empty", () => {
    expect(buildFirePrompt("", "explain")).toBe("explain");
  });

  it("returns only scope text when body is null", () => {
    expect(buildFirePrompt("context", null)).toBe("context");
  });

  it("returns empty string when both are empty", () => {
    expect(buildFirePrompt("", null)).toBe("");
  });
});

describe("getTypePrompt", () => {
  it("returns llmPromptQ for question type", () => {
    const prompt = getTypePrompt("question");
    expect(prompt).toContain("question");
  });

  it("returns llmPromptLlm for llm type", () => {
    const prompt = getTypePrompt("llm");
    expect(prompt).toContain("instruction");
  });

  it("returns empty string for bare type", () => {
    expect(getTypePrompt("bare")).toBe("");
  });
});

describe("fireAnnotation", () => {
  it("calls resolveAnnotationScopeWithMode with bidirectional", async () => {
    const view = makeView("hello world");
    const ann = makeAnnotation();

    await fireAnnotation({ view, annotation: ann });

    expect(mockResolve).toHaveBeenCalledWith(
      "hello world",
      ann.char_start,
      ann.scope,
      "en",
      "bidirectional",
    );
    view.destroy();
  });

  it("reads type-specific system prompt from preferences", async () => {
    usePreferencesStore.setState({ llmPromptQ: "Custom Q prompt" });
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "question" });

    await fireAnnotation({ view, annotation: ann });

    const callArgs = mockStream.mock.calls[0]![0];
    expect(callArgs.system).toBe("Custom Q prompt");
    view.destroy();
  });

  it("calls startLlmStream with model and text", async () => {
    mockResolve.mockResolvedValue({ start: 0, end: 5 });
    const view = makeView("hello world");
    const ann = makeAnnotation({ body: "explain" });

    await fireAnnotation({ view, annotation: ann });

    expect(mockStream).toHaveBeenCalledOnce();
    const [streamArgs] = mockStream.mock.calls[0]!;
    expect(streamArgs.model).toBe(usePreferencesStore.getState().llmModel);
    expect(streamArgs.text).toContain("hello");
    expect(streamArgs.text).toContain("explain");
    view.destroy();
  });

  it("sets llmLocked true before streaming", async () => {
    let lockedDuringCall = false;
    mockStream.mockImplementation(async () => {
      lockedDuringCall = useModalLockStore.getState().llmLocked;
    });

    const view = makeView();
    await fireAnnotation({ view, annotation: makeAnnotation() });

    expect(lockedDuringCall).toBe(true);
    view.destroy();
  });

  it("rejects when already llmLocked", async () => {
    useModalLockStore.setState({ llmLocked: true });
    const view = makeView();

    await expect(fireAnnotation({ view, annotation: makeAnnotation() }))
      .rejects.toThrow("LLM is already streaming");

    expect(mockStream).not.toHaveBeenCalled();
    view.destroy();
  });

  it("dispatches lit:fire-started event", async () => {
    const spy = vi.fn();
    window.addEventListener("lit:fire-started", spy);
    const view = makeView();
    await fireAnnotation({ view, annotation: makeAnnotation() });
    expect(spy).toHaveBeenCalledOnce();
    window.removeEventListener("lit:fire-started", spy);
    view.destroy();
  });

  it("onDone unlocks and dispatches lit:fire-complete", async () => {
    mockStream.mockImplementation(async (_args: unknown, callbacks: { onDone: () => void }) => {
      callbacks.onDone();
    });

    const completeSpy = vi.fn();
    window.addEventListener("lit:fire-complete", completeSpy);
    const view = makeView();
    await fireAnnotation({ view, annotation: makeAnnotation() });

    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(completeSpy).toHaveBeenCalledOnce();
    window.removeEventListener("lit:fire-complete", completeSpy);
    view.destroy();
  });

  it("onError unlocks and dispatches lit:fire-complete", async () => {
    mockStream.mockImplementation(async (_args: unknown, callbacks: { onError: (e: { message: string; retryable: boolean }) => void }) => {
      callbacks.onError({ message: "fail", retryable: false });
    });

    const view = makeView();
    await fireAnnotation({ view, annotation: makeAnnotation() });

    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(useLlmResponseStore.getState().status).toBe("error");
    view.destroy();
  });

  it("starts stream in llmResponse store", async () => {
    const view = makeView();
    let statusDuringCall = "";
    mockStream.mockImplementation(async () => {
      statusDuringCall = useLlmResponseStore.getState().status;
    });

    await fireAnnotation({ view, annotation: makeAnnotation({ body: "test" }) });

    expect(statusDuringCall).toBe("streaming");
    view.destroy();
  });

  // --- Cycle 9: Replacing fire behavior ---

  it("uses 'rewrite' prefix for replacing types (llm)", async () => {
    const view = makeView();
    await fireAnnotation({ view, annotation: makeAnnotation({ annotation_type: "llm" }) });
    expect(useLlmResponseStore.getState().prefix).toBe("rewrite");
    view.destroy();
  });

  it("uses 'ask' prefix for persisting types (question)", async () => {
    const view = makeView();
    await fireAnnotation({ view, annotation: makeAnnotation({ annotation_type: "question" }) });
    expect(useLlmResponseStore.getState().prefix).toBe("ask");
    view.destroy();
  });

  it("replacing type: replaces annotation range with response text on done", async () => {
    const doc = "hello world";
    const view = makeView(doc);
    const ann = makeAnnotation({ annotation_type: "llm", char_start: 0, char_end: 11 });

    mockStream.mockImplementation(async (_args: unknown, callbacks: { onChunk: (t: string) => void; onDone: () => void }) => {
      callbacks.onChunk("replacement text");
      callbacks.onDone();
    });

    await fireAnnotation({ view, annotation: ann });

    expect(view.state.doc.toString()).toBe("replacement text");
    view.destroy();
  });

  it("persisting type: does NOT replace document content on done", async () => {
    const doc = "hello world";
    const view = makeView(doc);
    const ann = makeAnnotation({ annotation_type: "question", char_start: 0, char_end: 11 });

    mockStream.mockImplementation(async (_args: unknown, callbacks: { onChunk: (t: string) => void; onDone: () => void }) => {
      callbacks.onChunk("the answer");
      callbacks.onDone();
    });

    await fireAnnotation({ view, annotation: ann });

    expect(view.state.doc.toString()).toBe("hello world");
    view.destroy();
  });

  // --- Cycle 10: Persisting fire sets fireSourceAnnotation ---

  it("persisting type: sets fireSourceAnnotation in store", async () => {
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "question" });

    mockStream.mockImplementation(async (_args: unknown, callbacks: { onChunk: (t: string) => void; onDone: () => void }) => {
      callbacks.onChunk("response");
      callbacks.onDone();
    });

    await fireAnnotation({ view, annotation: ann });

    const store = useLlmResponseStore.getState();
    expect(store.status).toBe("done");
    expect(store.responseText).toBe("response");
    expect(store.fireSourceAnnotation).toBe(ann);
    view.destroy();
  });

  it("replacing type: does NOT set fireSourceAnnotation", async () => {
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "llm" });

    await fireAnnotation({ view, annotation: ann });

    expect(useLlmResponseStore.getState().fireSourceAnnotation).toBeNull();
    view.destroy();
  });

  // --- Cycle 11: Spinner effects ---

  it("dispatches setFiringAnnotation effect before streaming", async () => {
    const view = makeView("hello world", true);
    let firingDuringStream = new Set<number>();

    mockStream.mockImplementation(async () => {
      firingDuringStream = view.state.field(firingAnnotationsField);
    });

    await fireAnnotation({ view, annotation: makeAnnotation({ char_start: 0 }) });

    expect(firingDuringStream.has(0)).toBe(true);
    view.destroy();
  });

  it("dispatches clearFiringAnnotation effect on done", async () => {
    const view = makeView("hello world", true);

    mockStream.mockImplementation(async (_args: unknown, callbacks: { onDone: () => void }) => {
      callbacks.onDone();
    });

    await fireAnnotation({ view, annotation: makeAnnotation({ char_start: 0 }) });

    const firingSet = view.state.field(firingAnnotationsField);
    expect(firingSet.has(0)).toBe(false);
    view.destroy();
  });

  it("dispatches clearFiringAnnotation effect on error", async () => {
    const view = makeView("hello world", true);

    mockStream.mockImplementation(async (_args: unknown, callbacks: { onError: (e: { message: string; retryable: boolean }) => void }) => {
      callbacks.onError({ message: "fail", retryable: false });
    });

    await fireAnnotation({ view, annotation: makeAnnotation({ char_start: 0 }) });

    const firingSet = view.state.field(firingAnnotationsField);
    expect(firingSet.has(0)).toBe(false);
    view.destroy();
  });
});

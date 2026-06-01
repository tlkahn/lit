import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Annotation } from "./ipc";
import { useModalLockStore } from "../stores/modalLock";
import { usePreferencesStore } from "../stores/preferences";
import { useLlmResponseStore } from "../stores/llmResponse";
import { useBottomPanelStore } from "../stores/bottomPanel";
import { firingAnnotationsField, annotationThreadKeysField } from "../editor/livePreview/annotationWidgets";

vi.mock("./ipc", () => ({
  resolveAnnotationScopeWithMode: vi.fn(async () => null),
  annotationFindUuid: vi.fn(async () => "fake-uuid-123"),
}));

vi.mock("./llmClient", () => ({
  startLlmStream: vi.fn(async () => {}),
}));

import { resolveAnnotationScopeWithMode, annotationFindUuid } from "./ipc";
import { startLlmStream } from "./llmClient";
import { fireAnnotation, buildFirePrompt, getTypePrompt, stripAnnotations } from "./fireOrchestrator";
import { useConversationStore } from "../stores/conversation";
import { useWorkspaceStore } from "../stores/workspace";

const mockResolve = resolveAnnotationScopeWithMode as ReturnType<typeof vi.fn>;
const mockStream = startLlmStream as ReturnType<typeof vi.fn>;
const mockFindUuid = annotationFindUuid as ReturnType<typeof vi.fn>;

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

function makeView(doc = "hello world", withFiringField = false): EditorView {
  const extensions = withFiringField ? [firingAnnotationsField, annotationThreadKeysField] : [];
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
    original: "<!--- llm | explain this --->",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useModalLockStore.setState({ llmLocked: false, openCount: 0, locked: false });
  useLlmResponseStore.getState().reset();
  useWorkspaceStore.setState({ currentPagePath: "test/page.md" });
  useBottomPanelStore.setState({ activeTab: "linked", unfolded: false });
  mockFindUuid.mockResolvedValue("fake-uuid-123");
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
    usePreferencesStore.setState({ llmPromptLlm: "Custom LLM prompt" });
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "llm" });

    await fireAnnotation({ view, annotation: ann });

    const callArgs = mockStream.mock.calls[0]![0];
    expect(callArgs.system).toBe("Custom LLM prompt");
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

  it("excludes annotation syntax from scope text sent to LLM", async () => {
    const doc = "接电话前先微笑\n<!--- llm | what does this mean? --->";
    const view = makeView(doc);
    const ann = makeAnnotation({
      annotation_type: "llm",
      body: "what does this mean?",
      char_start: 8,
      char_end: doc.length,
    });
    mockResolve.mockResolvedValue({ start: 0, end: doc.length });

    await fireAnnotation({ view, annotation: ann });

    const [streamArgs] = mockStream.mock.calls[0]!;
    expect(streamArgs.text).not.toContain("<!---");
    expect(streamArgs.text).not.toContain("--->");
    expect(streamArgs.text).toContain("接电话前先微笑");
    expect(streamArgs.text).toContain("what does this mean?");
    view.destroy();
  });

  it("strips multiple annotations from scope text", async () => {
    const doc = "paragraph <!--- todo | note1 ---> middle <!--- todo | note2 ---> end";
    const view = makeView(doc);
    const ann = makeAnnotation({
      annotation_type: "todo",
      body: "note1",
      char_start: 10,
      char_end: 39,
    });
    mockResolve.mockResolvedValue({ start: 0, end: doc.length });

    await fireAnnotation({ view, annotation: ann });

    const [streamArgs] = mockStream.mock.calls[0]!;
    expect(streamArgs.text).not.toContain("<!---");
    expect(streamArgs.text).not.toContain("--->");
    expect(streamArgs.text).toContain("paragraph");
    expect(streamArgs.text).toContain("middle");
    expect(streamArgs.text).toContain("end");
    view.destroy();
  });

  // --- Cycle 6.1: Persisting fires route through conversation store ---

  it("persisting type: calls sendAnnotationFire on conversation store", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    useConversationStore.setState({ sendAnnotationFire: sendSpy });
    mockFindUuid.mockResolvedValue("uuid-abc");
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "question", body: "what is this?" });

    await fireAnnotation({ view, annotation: ann });

    expect(sendSpy).toHaveBeenCalledOnce();
    const callArg = sendSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArg.nodeId).toBe("test/page.md");
    expect(callArg.annotationUuid).toBe("uuid-abc");
    expect(callArg.annotation).toBe(ann);
    expect(callArg.content).toBe("what is this?");
    expect(callArg.model).toBe(usePreferencesStore.getState().llmModel);
    view.destroy();
  });

  it("persisting type: does NOT call startLlmStream directly", async () => {
    useConversationStore.setState({ sendAnnotationFire: vi.fn(async () => {}) });
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "question" });

    await fireAnnotation({ view, annotation: ann });

    expect(mockStream).not.toHaveBeenCalled();
    view.destroy();
  });

  it("persisting type: passes system prompt and textOverride", async () => {
    usePreferencesStore.setState({ llmPromptQ: "Custom Q prompt" });
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    useConversationStore.setState({ sendAnnotationFire: sendSpy });
    mockResolve.mockResolvedValue({ start: 0, end: 5 });
    const view = makeView("hello world");
    const ann = makeAnnotation({ annotation_type: "question", body: "what?" });

    await fireAnnotation({ view, annotation: ann });

    const callArg = sendSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArg.system).toBe("Custom Q prompt");
    expect(callArg.textOverride).toContain("hello");
    expect(callArg.textOverride).toContain("what?");
    view.destroy();
  });

  it("persisting type: calls annotationFindUuid with correct args", async () => {
    useConversationStore.setState({ sendAnnotationFire: vi.fn(async () => {}) });
    const view = makeView();
    const ann = makeAnnotation({
      annotation_type: "note",
      body: "my note",
      char_start: 5,
    });

    await fireAnnotation({ view, annotation: ann });

    expect(mockFindUuid).toHaveBeenCalledWith("test/page.md", "note", "my note", 5);
    view.destroy();
  });

  it("persisting type: clears firing and unlocks when sendAnnotationFire resolves", async () => {
    useConversationStore.setState({ sendAnnotationFire: vi.fn(async () => {}) });
    const completeSpy = vi.fn();
    window.addEventListener("lit:fire-complete", completeSpy);
    const view = makeView("hello world", true);
    const ann = makeAnnotation({ annotation_type: "question", char_start: 0 });

    await fireAnnotation({ view, annotation: ann });
    await flushPromises();

    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(view.state.field(firingAnnotationsField).has(0)).toBe(false);
    expect(completeSpy).toHaveBeenCalledOnce();
    window.removeEventListener("lit:fire-complete", completeSpy);
    view.destroy();
  });

  it("persisting type: clears firing and unlocks when sendAnnotationFire rejects", async () => {
    useConversationStore.setState({
      sendAnnotationFire: vi.fn(async () => { throw new Error("stream failed"); }),
    });
    const completeSpy = vi.fn();
    window.addEventListener("lit:fire-complete", completeSpy);
    const view = makeView("hello world", true);
    const ann = makeAnnotation({ annotation_type: "question", char_start: 0 });

    await fireAnnotation({ view, annotation: ann });
    await flushPromises();

    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(view.state.field(firingAnnotationsField).has(0)).toBe(false);
    expect(completeSpy).toHaveBeenCalledOnce();
    window.removeEventListener("lit:fire-complete", completeSpy);
    view.destroy();
  });

  it("persisting type: skips sendAnnotationFire when annotationFindUuid returns null", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    useConversationStore.setState({ sendAnnotationFire: sendSpy });
    mockFindUuid.mockResolvedValue(null);
    const completeSpy = vi.fn();
    window.addEventListener("lit:fire-complete", completeSpy);
    const view = makeView("hello world", true);
    const ann = makeAnnotation({ annotation_type: "question", char_start: 0 });

    await fireAnnotation({ view, annotation: ann });

    expect(sendSpy).not.toHaveBeenCalled();
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(view.state.field(firingAnnotationsField).has(0)).toBe(false);
    expect(completeSpy).toHaveBeenCalledOnce();
    expect(useLlmResponseStore.getState().status).toBe("error");
    expect(useLlmResponseStore.getState().errorMessage).toBe("Annotation not found in index. Save the file and try again.");
    expect(useBottomPanelStore.getState().activeTab).toBe("llm-response");
    window.removeEventListener("lit:fire-complete", completeSpy);
    view.destroy();
  });

  it("persisting type: skips when currentPagePath is null", async () => {
    useWorkspaceStore.setState({ currentPagePath: null });
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    useConversationStore.setState({ sendAnnotationFire: sendSpy });
    const completeSpy = vi.fn();
    window.addEventListener("lit:fire-complete", completeSpy);
    const view = makeView("hello world", true);
    const ann = makeAnnotation({ annotation_type: "question", char_start: 0 });

    await fireAnnotation({ view, annotation: ann });

    expect(mockFindUuid).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(view.state.field(firingAnnotationsField).has(0)).toBe(false);
    expect(completeSpy).toHaveBeenCalledOnce();
    expect(useLlmResponseStore.getState().status).toBe("error");
    expect(useLlmResponseStore.getState().errorMessage).toBe("No active file. Open a file and try again.");
    expect(useBottomPanelStore.getState().activeTab).toBe("llm-response");
    window.removeEventListener("lit:fire-complete", completeSpy);
    view.destroy();
  });

  it("persisting type: clears firing and shows error when annotationFindUuid throws", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    useConversationStore.setState({ sendAnnotationFire: sendSpy });
    mockFindUuid.mockRejectedValue(new Error("IPC error"));
    const completeSpy = vi.fn();
    window.addEventListener("lit:fire-complete", completeSpy);
    const view = makeView("hello world", true);
    const ann = makeAnnotation({ annotation_type: "question", char_start: 0 });

    await fireAnnotation({ view, annotation: ann });

    expect(sendSpy).not.toHaveBeenCalled();
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(view.state.field(firingAnnotationsField).has(0)).toBe(false);
    expect(completeSpy).toHaveBeenCalledOnce();
    expect(useLlmResponseStore.getState().status).toBe("error");
    expect(useLlmResponseStore.getState().errorMessage).toBe("Failed to look up annotation. Save the file and try again.");
    expect(useBottomPanelStore.getState().activeTab).toBe("llm-response");
    window.removeEventListener("lit:fire-complete", completeSpy);
    view.destroy();
  });

  it("persisting type: does NOT call startStream on llmResponse store", async () => {
    useConversationStore.setState({ sendAnnotationFire: vi.fn(async () => {}) });
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "question" });

    await fireAnnotation({ view, annotation: ann });

    expect(useLlmResponseStore.getState().status).toBe("idle");
    view.destroy();
  });

  // --- Cycle 6.2: Persisting fire opens LLM panel ---

  it("persisting type: opens LLM panel", async () => {
    useConversationStore.setState({ sendAnnotationFire: vi.fn(async () => {}) });
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "question" });

    await fireAnnotation({ view, annotation: ann });

    expect(useBottomPanelStore.getState().activeTab).toBe("llm-response");
    expect(useBottomPanelStore.getState().unfolded).toBe(true);
    view.destroy();
  });

  // --- Cycle 6.3: Subscription-based firing cleanup ---

  it("persisting type: stream completion clears firing", async () => {
    useConversationStore.setState({
      sendAnnotationFire: vi.fn(async () => {
        useLlmResponseStore.getState().startStream({ question: "test" });
      }),
    });
    const completeSpy = vi.fn();
    window.addEventListener("lit:fire-complete", completeSpy);
    const view = makeView("hello world", true);
    const ann = makeAnnotation({ annotation_type: "question", char_start: 0 });

    await fireAnnotation({ view, annotation: ann });

    expect(view.state.field(firingAnnotationsField).has(0)).toBe(true);
    expect(completeSpy).not.toHaveBeenCalled();

    useLlmResponseStore.getState().finishStream();

    expect(view.state.field(firingAnnotationsField).has(0)).toBe(false);
    expect(completeSpy).toHaveBeenCalledOnce();
    window.removeEventListener("lit:fire-complete", completeSpy);
    view.destroy();
  });

  it("persisting type: stream error clears firing", async () => {
    useConversationStore.setState({
      sendAnnotationFire: vi.fn(async () => {
        useLlmResponseStore.getState().startStream({ question: "test" });
      }),
    });
    const completeSpy = vi.fn();
    window.addEventListener("lit:fire-complete", completeSpy);
    const view = makeView("hello world", true);
    const ann = makeAnnotation({ annotation_type: "question", char_start: 0 });

    await fireAnnotation({ view, annotation: ann });

    expect(view.state.field(firingAnnotationsField).has(0)).toBe(true);
    expect(completeSpy).not.toHaveBeenCalled();

    useLlmResponseStore.getState().setError("stream failed");

    expect(view.state.field(firingAnnotationsField).has(0)).toBe(false);
    expect(completeSpy).toHaveBeenCalledOnce();
    window.removeEventListener("lit:fire-complete", completeSpy);
    view.destroy();
  });

  it("persisting type: adds annotation UUID to annotationThreadKeysField", async () => {
    useConversationStore.setState({ sendAnnotationFire: vi.fn(async () => {}) });
    mockFindUuid.mockResolvedValue("uuid-thread-123");
    const view = makeView("hello world", true);
    const ann = makeAnnotation({ annotation_type: "question", char_start: 0 });

    await fireAnnotation({ view, annotation: ann });

    const threadKeys = view.state.field(annotationThreadKeysField);
    expect(threadKeys.has("uuid-thread-123")).toBe(true);
    view.destroy();
  });

  it("persisting type: returns a dispose function", async () => {
    useConversationStore.setState({
      sendAnnotationFire: vi.fn(async () => {
        useLlmResponseStore.getState().startStream({ question: "test" });
      }),
    });
    const view = makeView("hello world", true);
    const ann = makeAnnotation({ annotation_type: "question", char_start: 0 });

    const result = await fireAnnotation({ view, annotation: ann });

    expect(typeof result).toBe("function");
    view.destroy();
  });

  it("persisting type: destroying view mid-stream does not throw when stream finishes", async () => {
    useConversationStore.setState({
      sendAnnotationFire: vi.fn(async () => {
        useLlmResponseStore.getState().startStream({ question: "test" });
      }),
    });
    const view = makeView("hello world", true);
    const ann = makeAnnotation({ annotation_type: "question", char_start: 0 });

    const dispose = await fireAnnotation({ view, annotation: ann });
    expect(typeof dispose).toBe("function");

    // Destroy the view mid-stream
    view.destroy();
    // Call dispose (simulates what fireAnnotationPlugin.destroy() does)
    (dispose as () => void)();

    // Finishing the stream should not throw even though the view is destroyed
    expect(() => {
      useLlmResponseStore.getState().finishStream();
    }).not.toThrow();
  });

  it("persisting type: passes annotation body as content, scope+body as textOverride", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    useConversationStore.setState({ sendAnnotationFire: sendSpy });
    mockFindUuid.mockResolvedValue("uuid-content-test");
    mockResolve.mockResolvedValue({ start: 0, end: 5 });
    const view = makeView("hello world");
    const ann = makeAnnotation({ annotation_type: "question", body: "what is this?" });

    await fireAnnotation({ view, annotation: ann });

    const callArg = sendSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArg.content).toBe("what is this?");
    expect(callArg.textOverride).toContain("hello");
    expect(callArg.textOverride).toContain("what is this?");
    view.destroy();
  });

  it("persisting type: uses scope text as content when annotation body is null", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    useConversationStore.setState({ sendAnnotationFire: sendSpy });
    mockFindUuid.mockResolvedValue("uuid-null-body");
    mockResolve.mockResolvedValue({ start: 0, end: 5 });
    const view = makeView("hello world");
    const ann = makeAnnotation({ annotation_type: "question", body: null });

    await fireAnnotation({ view, annotation: ann });

    const callArg = sendSpy.mock.calls[0]![0] as Record<string, unknown>;
    // content should NOT be empty — it should be the scope text via buildFirePrompt
    expect(callArg.content).not.toBe("");
    expect(callArg.content).toBe(buildFirePrompt("hello", null));
    view.destroy();
  });

  // --- Fix: persisting branch cleanup / unlock tests ---

  it("persisting type: passes derived title to sendAnnotationFire", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    useConversationStore.setState({ sendAnnotationFire: sendSpy });
    mockFindUuid.mockResolvedValue("uuid-title-test");

    // Case 1: annotation with body
    const view1 = makeView();
    const ann1 = makeAnnotation({ annotation_type: "question", body: "what is X?" });
    await fireAnnotation({ view: view1, annotation: ann1 });
    // Need to reset lock for next fire
    useModalLockStore.setState({ llmLocked: false });

    const callArg1 = sendSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArg1.title).toBe("question: what is X?");
    view1.destroy();

    // Case 2: annotation with null body
    const view2 = makeView();
    const ann2 = makeAnnotation({ annotation_type: "note", body: null });
    await fireAnnotation({ view: view2, annotation: ann2 });

    const callArg2 = sendSpy.mock.calls[1]![0] as Record<string, unknown>;
    expect(callArg2.title).toBe("note");
    view2.destroy();
  });

  it("persisting type: unlocks when sendAnnotationFire resolves with non-streaming status", async () => {
    // sendAnnotationFire resolves without starting a stream (status stays idle)
    useConversationStore.setState({ sendAnnotationFire: vi.fn(async () => {}) });
    const view = makeView("hello world", true);
    const ann = makeAnnotation({ annotation_type: "question", char_start: 0 });

    await fireAnnotation({ view, annotation: ann });
    await flushPromises();

    expect(useModalLockStore.getState().llmLocked).toBe(false);
    view.destroy();
  });

  it("persisting type: unlocks when stream finishes via subscriber", async () => {
    // sendAnnotationFire starts a stream — the subscriber should unlock on done
    useConversationStore.setState({
      sendAnnotationFire: vi.fn(async () => {
        useLlmResponseStore.getState().startStream({ question: "test" });
      }),
    });
    const view = makeView("hello world", true);
    const ann = makeAnnotation({ annotation_type: "question", char_start: 0 });

    await fireAnnotation({ view, annotation: ann });

    // Status is streaming, so .finally() should NOT have unlocked
    expect(useModalLockStore.getState().llmLocked).toBe(true);

    // Finish the stream — subscriber should call cleanup and unlock
    useLlmResponseStore.getState().finishStream();

    expect(useModalLockStore.getState().llmLocked).toBe(false);
    view.destroy();
  });
});

describe("stripAnnotations", () => {
  it("removes annotation at end of text", () => {
    expect(stripAnnotations("接电话前先微笑\n<!--- q \\p | ask --->")).toBe("接电话前先微笑");
  });

  it("removes annotation in middle of text", () => {
    expect(stripAnnotations("before <!--- llm | body ---> after")).toBe("before after");
  });

  it("removes multiple annotations", () => {
    expect(stripAnnotations("a <!--- n | x ---> b <!--- q | y ---> c")).toBe("a b c");
  });

  it("removes block (multiline) annotation", () => {
    expect(stripAnnotations("text\n<!---\nq\n---\nbody\n--->\nmore")).toBe("text\nmore");
  });

  it("returns text unchanged when no annotations", () => {
    expect(stripAnnotations("just plain text")).toBe("just plain text");
  });

  it("returns empty string when annotation is entire text", () => {
    expect(stripAnnotations("<!--- q | body --->")).toBe("");
  });

  it("handles CJK text surrounding annotation", () => {
    expect(stripAnnotations("你好<!--- n | 注释 --->世界")).toBe("你好世界");
  });
});

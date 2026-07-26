import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Annotation } from "./ipc";
import { useModalLockStore } from "../stores/modalLock";
import { usePreferencesStore } from "../stores/preferences";
import { useStatusMessageStore } from "../stores/statusMessage";
import { useSecretStoreStore } from "../stores/secretStore";
import { firingAnnotationsField, firingRangeField } from "../editor/livePreview/annotationWidgets";
import { frontmatterFacet } from "../editor/livePreview/crossref";

vi.mock("./ipc", () => ({
  resolveAnnotationScopeWithMode: vi.fn(async () => null),
  secretStoreStatus: vi.fn(async () => ({ exists: true, unlocked: false })),
  autoUnlockSecretStore: vi.fn(async () => false),
}));

vi.mock("./llmClient", () => ({
  startLlmStream: vi.fn(async () => {}),
  cancelLlmStream: vi.fn(async () => {}),
}));

import { resolveAnnotationScopeWithMode } from "./ipc";
import { startLlmStream, cancelLlmStream } from "./llmClient";
import { fireAnnotation, buildFirePrompt, getTypePrompt, stripAnnotations } from "./fireOrchestrator";

const mockResolve = resolveAnnotationScopeWithMode as ReturnType<typeof vi.fn>;
const mockStream = startLlmStream as ReturnType<typeof vi.fn>;
const mockCancel = cancelLlmStream as ReturnType<typeof vi.fn>;

const flush = (n = 5) =>
  Array.from({ length: n }).reduce<Promise<void>>(
    (p) => p.then(() => new Promise((r) => queueMicrotask(r))),
    Promise.resolve(),
  );

function makeView(
  doc = "hello world",
  withFiringField = false,
  frontmatter?: Record<string, unknown>,
): EditorView {
  const extensions = [
    ...(withFiringField ? [firingAnnotationsField, firingRangeField] : []),
    ...(frontmatter ? [frontmatterFacet.of(frontmatter)] : []),
  ];
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
  useStatusMessageStore.setState({ message: null, variant: "success" });
  useSecretStoreStore.getState()._resetSettler();
  useSecretStoreStore.setState({ exists: true, unlocked: true, loading: false, migrationPromptOpen: false });
});

afterEach(() => {
  // Drain any lit:cancel-fire listeners leaked by tests whose stream mock
  // resolves without invoking onDone/onError (so doCleanup never ran). Each
  // leaked handler removes itself and is idempotent via its own cleanedUp flag.
  window.dispatchEvent(new CustomEvent("lit:cancel-fire"));
  mockStream.mockImplementation(async () => {});
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
    expect(streamArgs.model).toBe(usePreferencesStore.getState().llmProvider.model);
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
    expect(useStatusMessageStore.getState().message).toBe("fail");
    expect(useStatusMessageStore.getState().variant).toBe("error");
    view.destroy();
  });

  it("unlocks and shows error when startLlmStream throws synchronously", async () => {
    mockStream.mockImplementation(async () => {
      throw new Error("boom");
    });

    const completeSpy = vi.fn();
    window.addEventListener("lit:fire-complete", completeSpy);
    const view = makeView();

    await fireAnnotation({ view, annotation: makeAnnotation() });

    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(useStatusMessageStore.getState().message).toBe("boom");
    expect(useStatusMessageStore.getState().variant).toBe("error");
    expect(completeSpy).toHaveBeenCalledOnce();
    window.removeEventListener("lit:fire-complete", completeSpy);
    view.destroy();
  });

  // --- Cycle 9: Replacing fire behavior ---

  it("replacing type: transforms source in-place into a thread", async () => {
    const doc = "before <!--- llm | explain this ---> after";
    const view = makeView(doc);
    const ann = makeAnnotation({
      annotation_type: "llm",
      body: "explain this",
      char_start: 7,
      char_end: 36,
      original: "<!--- llm | explain this --->",
    });

    mockStream.mockImplementation(async (_args: unknown, callbacks: { onChunk: (t: string) => void; onDone: () => void }) => {
      callbacks.onChunk("replacement text");
      callbacks.onDone();
    });

    await fireAnnotation({ view, annotation: ann });

    const result = view.state.doc.toString();
    // source annotation is gone; replaced in-place by a thread
    expect(result).not.toContain("<!--- llm | explain this --->");
    expect(result).toContain("th");
    expect(result).toContain("[q]: explain this");
    expect(result).toContain("replacement text");
    // surrounding doc text intact
    expect(result).toMatch(/^before /);
    expect(result).toContain(" after");
    view.destroy();
  });

  it("replacing type: inline source produces block DSL starting at column 0", async () => {
    const doc = "before <!--- llm | explain this ---> after";
    const view = makeView(doc);
    const ann = makeAnnotation({
      annotation_type: "llm",
      body: "explain this",
      char_start: 7,
      char_end: 36,
      original: "<!--- llm | explain this --->",
    });

    mockStream.mockImplementation(async (_args: unknown, callbacks: { onChunk: (t: string) => void; onDone: () => void }) => {
      // Multi-line response forces block (multi-line) DSL form
      callbacks.onChunk("line one\nline two\nline three");
      callbacks.onDone();
    });

    await fireAnnotation({ view, annotation: ann });

    const result = view.state.doc.toString();
    const dslLine = result.split("\n").find((l) => l.startsWith("<!---"));
    expect(dslLine).toBeDefined();
    // No line may have <!--- preceded by other (non-whitespace) text
    expect(result).not.toMatch(/\S<!---/);
    view.destroy();
  });

  it("replacing type: trailing text after inline source moves to its own line", async () => {
    const doc = "before <!--- llm | explain this ---> after";
    const view = makeView(doc);
    const ann = makeAnnotation({
      annotation_type: "llm",
      body: "explain this",
      char_start: 7,
      char_end: 36,
      original: "<!--- llm | explain this --->",
    });

    mockStream.mockImplementation(async (_args: unknown, callbacks: { onChunk: (t: string) => void; onDone: () => void }) => {
      callbacks.onChunk("line one\nline two\nline three");
      callbacks.onDone();
    });

    await fireAnnotation({ view, annotation: ann });

    const result = view.state.doc.toString();
    const lines = result.split("\n");
    const closeLine = lines.find((l) => l.trimEnd().endsWith("--->"));
    expect(closeLine!.trimEnd()).toMatch(/--->$/);
    // " after" must NOT be on the close line (no trailing text after `--->`
    // on the same line)
    expect(closeLine).not.toMatch(/--->.*after/);
    view.destroy();
  });

  it("replacing type: column-0 block source is unchanged (no extra leading newline)", async () => {
    const doc = "<!--- llm | explain this --->\nrest";
    const view = makeView(doc);
    const ann = makeAnnotation({
      annotation_type: "llm",
      body: "explain this",
      char_start: 0,
      char_end: 29,
      original: "<!--- llm | explain this --->",
    });

    mockStream.mockImplementation(async (_args: unknown, callbacks: { onChunk: (t: string) => void; onDone: () => void }) => {
      callbacks.onChunk("line one\nline two\nline three");
      callbacks.onDone();
    });

    await fireAnnotation({ view, annotation: ann });

    const result = view.state.doc.toString();
    expect(result.startsWith("\n")).toBe(false);
    expect(result).toMatch(/^<!---/);
    view.destroy();
  });

  it("replacing type: on error, source annotation is not removed", async () => {
    const doc = "before <!--- llm | explain this ---> after";
    const view = makeView(doc);
    const ann = makeAnnotation({
      annotation_type: "llm",
      body: "explain this",
      char_start: 7,
      char_end: 36,
      original: "<!--- llm | explain this --->",
    });

    mockStream.mockImplementation(async (_args: unknown, callbacks: { onError: (e: { message: string; retryable: boolean }) => void }) => {
      callbacks.onError({ message: "API key invalid", retryable: false });
    });

    await fireAnnotation({ view, annotation: ann });

    const result = view.state.doc.toString();
    expect(result).toBe(doc);
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
    expect(firingSet.size).toBe(0);
    view.destroy();
  });

  it("onDone clears the firing entry after doc replacement (no ghost spinner)", async () => {
    const doc = "before <!--- llm | explain this ---> after";
    const view = makeView(doc, true);
    const ann = makeAnnotation({
      annotation_type: "llm",
      body: "explain this",
      char_start: 7,
      char_end: 36,
      original: "<!--- llm | explain this --->",
    });

    mockStream.mockImplementation(async (_args: unknown, callbacks: { onChunk: (t: string) => void; onDone: () => void }) => {
      callbacks.onChunk("replacement text");
      callbacks.onDone();
    });

    await fireAnnotation({ view, annotation: ann });

    const firingSet = view.state.field(firingAnnotationsField);
    expect(firingSet.size).toBe(0);
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

  it("mid-stream edit: replacement targets shifted range and doc is correct", async () => {
    const doc = "before <!--- llm | explain this ---> after";
    const view = makeView(doc, true);
    const ann = makeAnnotation({
      annotation_type: "llm",
      body: "explain this",
      char_start: 7,
      char_end: 36,
      original: "<!--- llm | explain this --->",
    });

    mockStream.mockImplementation(async (_args: unknown, callbacks: { onChunk: (t: string) => void; onDone: () => void }) => {
      // Simulate a user edit during streaming: insert "XX" at position 0.
      // This shifts the annotation from 7..36 to 9..38.
      view.dispatch({ changes: { from: 0, to: 0, insert: "XX" } });
      callbacks.onChunk("replacement text");
      callbacks.onDone();
    });

    await fireAnnotation({ view, annotation: ann });

    const result = view.state.doc.toString();
    // The source annotation should be gone (replaced at the shifted range)
    expect(result).not.toContain("<!--- llm | explain this --->");
    expect(result).toContain("[q]: explain this");
    expect(result).toContain("replacement text");
    // "XX" prefix should be intact
    expect(result.startsWith("XX")).toBe(true);
    expect(result).toContain("after");
    // No ghost spinner
    expect(view.state.field(firingAnnotationsField).size).toBe(0);
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
    const doc = "paragraph <!--- llm | note1 ---> middle <!--- llm | note2 ---> end";
    const view = makeView(doc);
    const ann = makeAnnotation({
      annotation_type: "llm",
      body: "note1",
      char_start: 10,
      char_end: 38,
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

  // --- Question type fires through the replacing (inline companion) path ---

  it("question type: calls startLlmStream (replacing path)", async () => {
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "question", body: "what is this?" });

    await fireAnnotation({ view, annotation: ann });

    expect(mockStream).toHaveBeenCalledOnce();
    const [streamArgs] = mockStream.mock.calls[0]!;
    expect(streamArgs.model).toBe(usePreferencesStore.getState().llmProvider.model);
    view.destroy();
  });

  it("question type: reads llmPromptQ system prompt from preferences", async () => {
    usePreferencesStore.setState({ llmPromptQ: "Custom Q prompt" });
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "question", body: "what?" });

    await fireAnnotation({ view, annotation: ann });

    const callArgs = mockStream.mock.calls[0]![0];
    expect(callArgs.system).toBe("Custom Q prompt");
    view.destroy();
  });

  it("question type: transforms source in-place into a thread", async () => {
    const doc = "before <!--- q | explain this ---> after";
    const view = makeView(doc);
    const ann = makeAnnotation({
      annotation_type: "question",
      body: "explain this",
      char_start: 7,
      char_end: 34,
      original: "<!--- q | explain this --->",
    });

    mockStream.mockImplementation(async (_args: unknown, callbacks: { onChunk: (t: string) => void; onDone: () => void }) => {
      callbacks.onChunk("replacement text");
      callbacks.onDone();
    });

    await fireAnnotation({ view, annotation: ann });

    const result = view.state.doc.toString();
    expect(result).not.toContain("<!--- q | explain this --->");
    expect(result).toContain("th");
    expect(result).toContain("[q]: explain this");
    expect(result).toContain("replacement text");
    expect(result).toMatch(/^before /);
    expect(result).toContain(" after");
    view.destroy();
  });

  it("question type: unlocks and dispatches lit:fire-complete on done", async () => {
    mockStream.mockImplementation(async (_args: unknown, callbacks: { onDone: () => void }) => {
      callbacks.onDone();
    });
    const completeSpy = vi.fn();
    window.addEventListener("lit:fire-complete", completeSpy);
    const view = makeView();

    await fireAnnotation({ view, annotation: makeAnnotation({ annotation_type: "question" }) });

    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(completeSpy).toHaveBeenCalledOnce();
    window.removeEventListener("lit:fire-complete", completeSpy);
    view.destroy();
  });

  it("non-fireable type: returns early without calling startLlmStream", async () => {
    const completeSpy = vi.fn();
    window.addEventListener("lit:fire-complete", completeSpy);
    const view = makeView("hello world", true);
    const ann = makeAnnotation({ annotation_type: "bare" as Annotation["annotation_type"], char_start: 0 });

    await fireAnnotation({ view, annotation: ann });

    expect(mockStream).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(view.state.field(firingAnnotationsField).has(0)).toBe(false);
    expect(completeSpy).toHaveBeenCalledOnce();
    window.removeEventListener("lit:fire-complete", completeSpy);
    view.destroy();
  });

  it("lit:cancel-fire event calls cancelLlmStream and unlocks", async () => {
    mockStream.mockImplementation(() => new Promise(() => {}));
    const completeSpy = vi.fn();
    const view = makeView("hello world", true);
    const ann = makeAnnotation({ annotation_type: "llm", char_start: 0 });

    const firePromise = fireAnnotation({ view, annotation: ann });
    await flush();

    window.addEventListener("lit:fire-complete", completeSpy);
    window.dispatchEvent(new CustomEvent("lit:cancel-fire"));
    await flush();

    expect(mockCancel).toHaveBeenCalledOnce();
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(completeSpy).toHaveBeenCalledOnce();
    expect(view.state.field(firingAnnotationsField).has(0)).toBe(false);

    window.removeEventListener("lit:fire-complete", completeSpy);
    view.destroy();
    void firePromise;
  });

  it("cancel during setup (before stream starts) releases the lock and clears the spinner", async () => {
    // Force the function to park on ensureUnlocked: locked store whose
    // auto-unlock returns false, so the migration prompt opens.
    useSecretStoreStore.getState()._resetSettler();
    useSecretStoreStore.setState({ exists: true, unlocked: false, migrationPromptOpen: false });
    // Safety net: if the stream were ever started, it must not resolve.
    mockStream.mockImplementation(() => new Promise(() => {}));
    const view = makeView("hello world", true);
    const ann = makeAnnotation({ annotation_type: "llm", char_start: 0 });

    const promise = fireAnnotation({ view, annotation: ann });
    await flush(); // parked on ensureUnlocked: spinner shown, lock held

    // Sanity: mid-setup state.
    expect(useModalLockStore.getState().llmLocked).toBe(true);
    expect(view.state.field(firingAnnotationsField).has(0)).toBe(true);

    window.dispatchEvent(new CustomEvent("lit:cancel-fire"));
    await flush();

    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(view.state.field(firingAnnotationsField).has(0)).toBe(false);
    expect(mockCancel).toHaveBeenCalled();
    expect(mockStream).not.toHaveBeenCalled();

    view.destroy();
    void promise;
  });

  // --- ensureUnlocked guard on replacing fire path ---

  it("replacing type: calls ensureUnlocked before startLlmStream when store is locked", async () => {
    useSecretStoreStore.setState({ exists: true, unlocked: false });
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "llm" });

    const firePromise = fireAnnotation({ view, annotation: ann });

    await flush();

    // ensureUnlocked should have opened the migration prompt
    expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(true);
    // startLlmStream should NOT have been called yet
    expect(mockStream).not.toHaveBeenCalled();

    // Simulate user completing migration
    useSecretStoreStore.getState().settleMigration(true);
    await firePromise;

    // Now startLlmStream should have been called
    expect(mockStream).toHaveBeenCalledOnce();
    view.destroy();
  });

  it("replacing type: cleans up and does not call startLlmStream when ensureUnlocked is cancelled", async () => {
    useSecretStoreStore.setState({ exists: true, unlocked: false });
    const completeSpy = vi.fn();
    window.addEventListener("lit:fire-complete", completeSpy);
    const view = makeView("hello world", true);
    const ann = makeAnnotation({ annotation_type: "llm", char_start: 0 });

    const firePromise = fireAnnotation({ view, annotation: ann });

    await flush();

    // Prompt should be open
    expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(true);

    // User cancels
    useSecretStoreStore.getState().settleMigration(false);
    await firePromise;

    // startLlmStream should NOT have been called
    expect(mockStream).not.toHaveBeenCalled();
    // Cleanup should have occurred
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(completeSpy).toHaveBeenCalledOnce();
    expect(view.state.field(firingAnnotationsField).has(0)).toBe(false);
    window.removeEventListener("lit:fire-complete", completeSpy);
    view.destroy();
  });

  it("passes contextWindow for a custom provider", async () => {
    usePreferencesStore.setState({
      llmProvider: { providerId: "custom-vllm", model: "m", baseUrl: "http://x", apiKeySet: false },
      llmCustomProviders: [
        { id: "custom-vllm", name: "vLLM", baseUrl: "http://x", needsApiKey: false, modelId: "m", contextWindow: 8000 },
      ],
    });
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "llm" });

    await fireAnnotation({ view, annotation: ann });

    expect(mockStream.mock.calls[0]![0].contextWindow).toBe(8000);
    view.destroy();
  });

  it("uses custom provider def baseUrl when no manual override is set", async () => {
    usePreferencesStore.setState({
      llmProvider: { providerId: "custom-vllm", model: "m", apiKeySet: false },
      llmCustomProviders: [
        { id: "custom-vllm", name: "vLLM", baseUrl: "http://localhost:8000/v1", needsApiKey: false, modelId: "m", contextWindow: 8000 },
      ],
    });
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "llm" });

    await fireAnnotation({ view, annotation: ann });

    expect(mockStream.mock.calls[0]![0].baseUrl).toBe("http://localhost:8000/v1");
    view.destroy();
  });

  it("manual override baseUrl wins over custom provider def baseUrl", async () => {
    usePreferencesStore.setState({
      llmProvider: { providerId: "custom-vllm", model: "m", baseUrl: "http://override", apiKeySet: false },
      llmCustomProviders: [
        { id: "custom-vllm", name: "vLLM", baseUrl: "http://localhost:8000/v1", needsApiKey: false, modelId: "m", contextWindow: 8000 },
      ],
    });
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "llm" });

    await fireAnnotation({ view, annotation: ann });

    expect(mockStream.mock.calls[0]![0].baseUrl).toBe("http://override");
    view.destroy();
  });

  it("does NOT set contextWindow for a built-in provider", async () => {
    usePreferencesStore.setState({
      llmProvider: { providerId: "anthropic", model: "claude-sonnet-4-6", apiKeySet: false },
    });
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "llm" });

    await fireAnnotation({ view, annotation: ann });

    expect(mockStream.mock.calls[0]![0].contextWindow).toBeUndefined();
    view.destroy();
  });

  it("does NOT set contextWindow when providerId is custom- but no matching def exists", async () => {
    usePreferencesStore.setState({
      llmProvider: { providerId: "custom-missing", model: "m", apiKeySet: false },
      llmCustomProviders: [],
    });
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "llm" });

    await fireAnnotation({ view, annotation: ann });

    expect(mockStream.mock.calls[0]![0].contextWindow).toBeUndefined();
    view.destroy();
  });

  it("replacing type: proceeds without prompting when store is already unlocked", async () => {
    useSecretStoreStore.setState({ exists: true, unlocked: true });
    const view = makeView();
    const ann = makeAnnotation({ annotation_type: "llm" });

    await fireAnnotation({ view, annotation: ann });

    // No prompt should have been opened
    expect(useSecretStoreStore.getState().migrationPromptOpen).toBe(false);
    // Stream should have been called
    expect(mockStream).toHaveBeenCalledOnce();
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

  it("removes legacy %%!...%% annotation", () => {
    expect(stripAnnotations("hello %%! n | note %% world")).toBe("hello world");
  });

  it("removes mixed new-format and legacy annotations", () => {
    expect(stripAnnotations("a <!--- x ---> b %%! y %% c")).toBe("a b c");
  });

  // --- three-scope segmentation language (#854) ---

  it("resolves the scope under the annotation's own lang", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "zh" });
    const view = makeView("hello world", false, { "annotation-lang": "ja" });
    const ann = makeAnnotation({ lang: "fr" });

    await fireAnnotation({ view, annotation: ann });

    expect(mockResolve).toHaveBeenCalledWith(
      "hello world",
      ann.char_start,
      ann.scope,
      "fr",
      "bidirectional",
    );
    view.destroy();
  });

  it("falls back to the document frontmatter language", async () => {
    usePreferencesStore.setState({ annotationDefaultLang: "zh" });
    const view = makeView("hello world", false, { lang: "fr-CA" });
    const ann = makeAnnotation();

    await fireAnnotation({ view, annotation: ann });

    expect(mockResolve).toHaveBeenCalledWith(
      "hello world",
      ann.char_start,
      ann.scope,
      "fr",
      "bidirectional",
    );
    view.destroy();
  });
});

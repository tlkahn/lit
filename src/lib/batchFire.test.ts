import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useModalLockStore } from "../stores/modalLock";
import { annotationDataField, setAnnotationData } from "../editor/livePreview/annotationState";
import type { Annotation } from "./ipc";

vi.mock("./ipc", () => ({
  resolveAnnotationScopeWithMode: vi.fn(async () => null),
  parseAnnotations: vi.fn(async () => []),
}));

vi.mock("./llmClient", () => ({
  startLlmStream: vi.fn(async () => {}),
}));

vi.mock("./fireOrchestrator", () => ({
  fireAnnotation: vi.fn(async () => {}),
}));

import { fireAnnotation } from "./fireOrchestrator";
const mockFireAnnotation = fireAnnotation as ReturnType<typeof vi.fn>;

import { batchFireReplacingAnnotations } from "./batchFire";

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    form: "compact",
    annotation_type: "llm",
    certainty: "neutral",
    scope: { kind: "sentence", value: 1 },
    body: "explain",
    date: null,
    is_structured: true,
    char_start: 0,
    char_end: 20,
    original: "<!--- llm | explain --->",
    ...overrides,
  };
}

function makeView(annotations: Annotation[]): EditorView {
  const state = EditorState.create({
    doc: "a".repeat(100),
    extensions: [annotationDataField],
  });
  const view = new EditorView({
    state,
    parent: document.createElement("div"),
  });
  view.dispatch({ effects: setAnnotationData.of(annotations) });
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  useModalLockStore.setState({ llmLocked: false, openCount: 0, locked: false });
});

describe("batchFireReplacingAnnotations", () => {
  it("fires each replacing annotation sequentially, sorted by char_start descending", async () => {
    const ann1 = makeAnnotation({ annotation_type: "llm", char_start: 10, char_end: 30 });
    const ann2 = makeAnnotation({ annotation_type: "translation", char_start: 40, char_end: 60 });
    const view = makeView([ann1, ann2]);

    await batchFireReplacingAnnotations(view);

    expect(mockFireAnnotation).toHaveBeenCalledTimes(2);
    expect(mockFireAnnotation.mock.calls[0]![0].annotation.char_start).toBe(40);
    expect(mockFireAnnotation.mock.calls[1]![0].annotation.char_start).toBe(10);

    view.destroy();
  });

  it("skips persisting types", async () => {
    const ann1 = makeAnnotation({ annotation_type: "question", char_start: 0, char_end: 20 });
    const ann2 = makeAnnotation({ annotation_type: "llm", char_start: 30, char_end: 50 });
    const view = makeView([ann1, ann2]);

    await batchFireReplacingAnnotations(view);

    expect(mockFireAnnotation).toHaveBeenCalledTimes(1);
    expect(mockFireAnnotation.mock.calls[0]![0].annotation.annotation_type).toBe("llm");

    view.destroy();
  });

  it("no-ops when llmLocked", async () => {
    useModalLockStore.setState({ llmLocked: true });
    const ann = makeAnnotation({ annotation_type: "llm" });
    const view = makeView([ann]);

    await batchFireReplacingAnnotations(view);

    expect(mockFireAnnotation).not.toHaveBeenCalled();

    view.destroy();
  });

  it("no-ops when no replacing annotations exist", async () => {
    const ann = makeAnnotation({ annotation_type: "question", char_start: 0, char_end: 20 });
    const view = makeView([ann]);

    await batchFireReplacingAnnotations(view);

    expect(mockFireAnnotation).not.toHaveBeenCalled();

    view.destroy();
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnnotationPanel } from "./AnnotationPanel";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { annotationDataField, setAnnotationData } from "../editor/livePreview/annotationState";
import { setCurrentEditorView } from "../lib/editorViewRef";
import type { Annotation } from "../lib/ipc";

vi.mock("../lib/ipc", () => ({
  parseAnnotations: vi.fn(async () => []),
  resolveAnnotationScope: vi.fn(async () => null),
}));

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    form: "compact",
    annotation_type: "note",
    certainty: "neutral",
    scope: { kind: "words", value: 0 },
    body: "test body",
    date: null,
    is_structured: true,
    char_start: 0,
    char_end: 10,
    original: "%%!n | x%%",
    ...overrides,
  };
}

function setupEditorView(doc: string, annotations: Annotation[]) {
  const state = EditorState.create({
    doc,
    extensions: [annotationDataField],
  });
  const view = new EditorView({ state, parent: document.createElement("div") });
  if (annotations.length > 0) {
    view.dispatch({ effects: setAnnotationData.of(annotations) });
  }
  setCurrentEditorView(view);
  return view;
}

describe("AnnotationPanel", () => {
  let editorView: EditorView | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentEditorView(null);
  });

  afterEach(() => {
    editorView?.destroy();
    editorView = null;
    setCurrentEditorView(null);
  });

  it("renders 'No annotations' when list is empty", () => {
    editorView = setupEditorView("hello", []);
    render(<AnnotationPanel pageId="test.md" />);
    expect(screen.getByText("No annotations")).toBeInTheDocument();
  });

  it("renders 'No annotations' when no editor view", () => {
    render(<AnnotationPanel pageId="test.md" />);
    expect(screen.getByText("No annotations")).toBeInTheDocument();
  });

  it("renders entries sorted by document position", () => {
    const annotations = [
      makeAnnotation({ char_start: 20, char_end: 30, body: "second" }),
      makeAnnotation({ char_start: 5, char_end: 15, body: "first" }),
    ];
    editorView = setupEditorView("a".repeat(50), annotations);
    render(<AnnotationPanel pageId="test.md" />);

    const entry0 = screen.getByTestId("annotation-body-0");
    const entry1 = screen.getByTestId("annotation-body-1");
    expect(entry0.textContent).toBe("first");
    expect(entry1.textContent).toBe("second");
  });

  it("each entry shows type badge with data-annotation-type", () => {
    const annotations = [
      makeAnnotation({ annotation_type: "question", char_start: 0, char_end: 10 }),
    ];
    editorView = setupEditorView("a".repeat(20), annotations);
    render(<AnnotationPanel pageId="test.md" />);

    const badge = screen.getByTestId("annotation-badge-0");
    expect(badge.dataset.annotationType).toBe("question");
    expect(badge.textContent).toBe("?");
  });

  it("each entry shows certainty mark", () => {
    const annotations = [
      makeAnnotation({ certainty: "tentative", char_start: 0, char_end: 10 }),
    ];
    editorView = setupEditorView("a".repeat(20), annotations);
    render(<AnnotationPanel pageId="test.md" />);

    expect(screen.getByTestId("annotation-certainty-0").textContent).toBe("?");
  });

  it("shows date when present", () => {
    const annotations = [
      makeAnnotation({ date: "2026-04", char_start: 0, char_end: 10 }),
    ];
    editorView = setupEditorView("a".repeat(20), annotations);
    render(<AnnotationPanel pageId="test.md" />);

    expect(screen.getByTestId("annotation-date-0").textContent).toBe("2026-04");
  });

  it("shows line number", () => {
    const doc = "line one\nline two\nline three";
    const annotations = [
      makeAnnotation({ char_start: 18, char_end: 27, body: "on line 3" }),
    ];
    editorView = setupEditorView(doc, annotations);
    render(<AnnotationPanel pageId="test.md" />);

    expect(screen.getByTestId("annotation-line-0").textContent).toBe("L3");
  });

  it("shows truncated body preview", () => {
    const longBody = "a".repeat(80);
    const annotations = [
      makeAnnotation({ body: longBody, char_start: 0, char_end: 10 }),
    ];
    editorView = setupEditorView("a".repeat(20), annotations);
    render(<AnnotationPanel pageId="test.md" />);

    const body = screen.getByTestId("annotation-body-0").textContent!;
    expect(body.length).toBe(61);
    expect(body.endsWith("…")).toBe(true);
  });

  it("click entry dispatches selection and scrollIntoView to annotation position", async () => {
    const annotations = [
      makeAnnotation({ char_start: 5, char_end: 15, body: "clickable" }),
    ];
    editorView = setupEditorView("a".repeat(20), annotations);
    const dispatchSpy = vi.spyOn(editorView!, "dispatch");
    render(<AnnotationPanel pageId="test.md" />);

    await userEvent.click(screen.getByTestId("annotation-entry-0"));

    expect(editorView!.state.selection.main.head).toBe(5);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { anchor: 5 },
        effects: expect.anything(),
      }),
    );
  });

  it("calls onCountChange with annotation count", () => {
    const onCountChange = vi.fn();
    const annotations = [
      makeAnnotation({ char_start: 0, char_end: 10 }),
      makeAnnotation({ char_start: 15, char_end: 25 }),
    ];
    editorView = setupEditorView("a".repeat(30), annotations);
    render(<AnnotationPanel pageId="test.md" onCountChange={onCountChange} />);

    expect(onCountChange).toHaveBeenCalledWith(2);
  });

  it("re-reads annotations when lit:annotations-changed fires", () => {
    editorView = setupEditorView("hello world", []);
    render(<AnnotationPanel pageId="test.md" />);
    expect(screen.getByText("No annotations")).toBeInTheDocument();

    const newAnnotations = [makeAnnotation({ body: "new one", char_start: 0, char_end: 5 })];
    editorView!.dispatch({ effects: setAnnotationData.of(newAnnotations) });

    act(() => {
      window.dispatchEvent(new CustomEvent("lit:annotations-changed"));
    });

    expect(screen.queryByText("No annotations")).not.toBeInTheDocument();
    expect(screen.getByTestId("annotation-body-0").textContent).toBe("new one");
  });

  it("lit:show-annotation event highlights matching entry", () => {
    const annotations = [
      makeAnnotation({ char_start: 0, char_end: 10, body: "first" }),
      makeAnnotation({ char_start: 15, char_end: 25, body: "second" }),
    ];
    editorView = setupEditorView("a".repeat(30), annotations);
    render(<AnnotationPanel pageId="test.md" />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("lit:show-annotation", { detail: { charStart: 15 } }),
      );
    });

    const entry1 = screen.getByTestId("annotation-entry-1");
    expect(entry1.className).toContain("bg-bg-secondary");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState, ChangeSet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { PillWidget, MarkerWidget, ThreadWidget, toggleAnnotationFoldEffect, setAllAnnotationFoldsEffect, annotationFoldField, threadTurnField, setThreadTurnEffect, createCardboxLinkButton } from "./annotationWidgets";
import { CLS } from "./annotationConstants";
import type { Annotation } from "../../lib/ipc";
import { useMarkConfigStore } from "../../stores/markConfig";

vi.mock("../../lib/ipc", () => ({
  parseAnnotations: vi.fn(async () => []),
  resolveAnnotationScope: vi.fn(async () => null),
}));

vi.mock("./annotationHover", () => ({
  handleAnnotationHover: vi.fn(),
  handleAnnotationLeave: vi.fn(),
}));

import { handleAnnotationHover, handleAnnotationLeave } from "./annotationHover";
const mockHandleHover = handleAnnotationHover as ReturnType<typeof vi.fn>;
const mockHandleLeave = handleAnnotationLeave as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

function makeEditorView(doc = "hello world"): EditorView {
  const state = EditorState.create({ doc });
  return new EditorView({ state, parent: document.createElement("div") });
}

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
    char_end: 17,
    original: "<!---n | body--->",
    ...overrides,
  };
}

describe("PillWidget", () => {
  it("toDOM returns span.cm-annotation-pill", () => {
    const view = makeEditorView();
    const w = new PillWidget(makeAnnotation({ body: "body" }));
    const dom = w.toDOM(view);
    expect(dom.tagName).toBe("SPAN");
    expect(dom.classList.contains("cm-annotation-pill")).toBe(true);
    view.destroy();
  });

  it("renders type icon and body but never a date", () => {
    const view = makeEditorView();
    const ann = makeAnnotation({
      annotation_type: "note",
      certainty: "firm",
      body: "hello",
      date: "2026-04",
      char_start: 0,
      char_end: 22,
      original: "<!---n | hello @2026-04--->",
    });
    const w = new PillWidget(ann);
    const dom = w.toDOM(view);
    expect(dom.querySelector(".cm-annotation-pill-icon")!.textContent).toBe("N");
    expect(dom.querySelector(".cm-annotation-pill-body")!.textContent).toBe("hello");
    expect(dom.querySelector(".cm-annotation-date")).toBeNull();
    expect(dom.classList.contains("cm-annotation-firm")).toBe(true);
    view.destroy();
  });

  it("adds tentative class for tentative certainty", () => {
    const view = makeEditorView();
    const w = new PillWidget(makeAnnotation({ certainty: "tentative", body: "maybe" }));
    const dom = w.toDOM(view);
    expect(dom.classList.contains("cm-annotation-tentative")).toBe(true);
    view.destroy();
  });

  it("truncates body longer than 60 chars", () => {
    const view = makeEditorView();
    const longBody = "a".repeat(80);
    const w = new PillWidget(makeAnnotation({ body: longBody }));
    const dom = w.toDOM(view);
    const bodyText = dom.querySelector(".cm-annotation-pill-body")!.textContent!;
    expect(bodyText.length).toBe(61);
    expect(bodyText.endsWith("…")).toBe(true);
    view.destroy();
  });

  it("eq returns true when original + charStart + charEnd match", () => {
    const a = new PillWidget(makeAnnotation({ original: "<!---n--->", char_start: 0, char_end: 10 }));
    const b = new PillWidget(makeAnnotation({ original: "<!---n--->", char_start: 0, char_end: 10, body: "different" }));
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false when different", () => {
    const a = new PillWidget(makeAnnotation({ original: "<!---n--->", char_start: 0, char_end: 10 }));
    const b = new PillWidget(makeAnnotation({ original: "<!---q--->", char_start: 0, char_end: 10 }));
    expect(a.eq(b)).toBe(false);
  });

  it("estimatedHeight returns a value", () => {
    const w = new PillWidget(makeAnnotation());
    expect(w.estimatedHeight).toBeGreaterThan(0);
  });

  it("ignoreEvent returns true for mousedown", () => {
    const w = new PillWidget(makeAnnotation());
    expect(w.ignoreEvent(new MouseEvent("mousedown"))).toBe(true);
  });

  it("ignoreEvent returns false for click", () => {
    const w = new PillWidget(makeAnnotation());
    expect(w.ignoreEvent(new MouseEvent("click"))).toBe(false);
  });

  it("mouseenter triggers handleAnnotationHover with (view, annotation)", () => {
    const view = makeEditorView();
    const ann = makeAnnotation({ char_start: 3 });
    const w = new PillWidget(ann);
    const dom = w.toDOM(view);
    dom.dispatchEvent(new Event("mouseenter"));
    expect(mockHandleHover).toHaveBeenCalledOnce();
    expect(mockHandleHover).toHaveBeenCalledWith(view, ann, { altKey: undefined });
    view.destroy();
  });

  it("mouseleave triggers handleAnnotationLeave with (view, annotation)", () => {
    const view = makeEditorView();
    const ann = makeAnnotation();
    const w = new PillWidget(ann);
    const dom = w.toDOM(view);
    dom.dispatchEvent(new Event("mouseleave"));
    expect(mockHandleLeave).toHaveBeenCalledOnce();
    expect(mockHandleLeave).toHaveBeenCalledWith(view, ann);
    view.destroy();
  });
});

describe("PillWidget mark type", () => {
  beforeEach(() => {
    useMarkConfigStore.setState({ config: { nb: { label: "nota bene", icon: "B" } }, loaded: true });
  });

  afterEach(() => {
    useMarkConfigStore.setState({ config: {}, loaded: false });
  });

  it("renders cm-annotation-pill-minimal for mark type", () => {
    const view = makeEditorView();
    const w = new PillWidget(makeAnnotation({ annotation_type: "mark", mark: "nb", body: "ignored" }));
    const dom = w.toDOM(view);
    expect(dom.classList.contains("cm-annotation-pill")).toBe(true);
    expect(dom.classList.contains("cm-annotation-pill-minimal")).toBe(true);
    view.destroy();
  });

  it("mark pill icon comes from getMarkIcon", () => {
    const view = makeEditorView();
    const w = new PillWidget(makeAnnotation({ annotation_type: "mark", mark: "nb" }));
    const dom = w.toDOM(view);
    expect(dom.querySelector(".cm-annotation-pill-icon")!.textContent).toBe("B");
    view.destroy();
  });

  it("mark pill falls back to code when no config icon", () => {
    useMarkConfigStore.setState({ config: {}, loaded: true });
    const view = makeEditorView();
    const w = new PillWidget(makeAnnotation({ annotation_type: "mark", mark: "sic" }));
    const dom = w.toDOM(view);
    expect(dom.querySelector(".cm-annotation-pill-icon")!.textContent).toBe("sic");
    view.destroy();
  });

  it("mark pill sets data-mark attribute", () => {
    const view = makeEditorView();
    const w = new PillWidget(makeAnnotation({ annotation_type: "mark", mark: "nb" }));
    const dom = w.toDOM(view) as HTMLElement;
    expect(dom.dataset.mark).toBe("nb");
    view.destroy();
  });

  it("mark pill renders no body and no date", () => {
    const view = makeEditorView();
    const w = new PillWidget(makeAnnotation({ annotation_type: "mark", mark: "nb", body: "should not show", date: "2026-04" }));
    const dom = w.toDOM(view);
    expect(dom.querySelector(".cm-annotation-pill-body")).toBeNull();
    expect(dom.querySelector(".cm-annotation-date")).toBeNull();
    view.destroy();
  });

  it("mark pill adds tentative certainty class", () => {
    const view = makeEditorView();
    const w = new PillWidget(makeAnnotation({ annotation_type: "mark", mark: "nb", certainty: "tentative" }));
    const dom = w.toDOM(view);
    expect(dom.classList.contains("cm-annotation-tentative")).toBe(true);
    view.destroy();
  });

  it("mark pill adds firm certainty class", () => {
    const view = makeEditorView();
    const w = new PillWidget(makeAnnotation({ annotation_type: "mark", mark: "nb", certainty: "firm" }));
    const dom = w.toDOM(view);
    expect(dom.classList.contains("cm-annotation-firm")).toBe(true);
    view.destroy();
  });

  it("neutral mark pill has no certainty class", () => {
    const view = makeEditorView();
    const w = new PillWidget(makeAnnotation({ annotation_type: "mark", mark: "nb", certainty: "neutral" }));
    const dom = w.toDOM(view);
    expect(dom.classList.contains("cm-annotation-tentative")).toBe(false);
    expect(dom.classList.contains("cm-annotation-firm")).toBe(false);
    view.destroy();
  });

  it("mark pill renders no fire button", () => {
    const view = makeEditorView();
    const w = new PillWidget(makeAnnotation({ annotation_type: "mark", mark: "nb" }));
    const dom = w.toDOM(view);
    expect(dom.querySelector(".cm-annotation-fire-btn")).toBeNull();
    view.destroy();
  });

  it("eq returns false when mark differs", () => {
    const a = new PillWidget(makeAnnotation({ annotation_type: "mark", original: "<!---*nb--->", char_start: 0, char_end: 10, mark: "nb" }));
    const b = new PillWidget(makeAnnotation({ annotation_type: "mark", original: "<!---*nb--->", char_start: 0, char_end: 10, mark: "sic" }));
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns true when mark matches", () => {
    const a = new PillWidget(makeAnnotation({ annotation_type: "mark", original: "<!---*nb--->", char_start: 0, char_end: 10, mark: "nb" }));
    const b = new PillWidget(makeAnnotation({ annotation_type: "mark", original: "<!---*nb--->", char_start: 0, char_end: 10, mark: "nb" }));
    expect(a.eq(b)).toBe(true);
  });
});

describe("annotationFoldField", () => {
  it("initial state is an empty Map", () => {
    const state = EditorState.create({ extensions: [annotationFoldField] });
    const fold = state.field(annotationFoldField);
    expect(fold.size).toBe(0);
  });

  it("toggleAnnotationFoldEffect toggles fold state", () => {
    const state = EditorState.create({ doc: "hello", extensions: [annotationFoldField] });
    const tr1 = state.update({ effects: toggleAnnotationFoldEffect.of({ pos: 0 }) });
    const fold1 = tr1.state.field(annotationFoldField);
    expect(fold1.get(0)).toBe(true);

    const tr2 = tr1.state.update({ effects: toggleAnnotationFoldEffect.of({ pos: 0 }) });
    const fold2 = tr2.state.field(annotationFoldField);
    expect(fold2.get(0)).toBe(false);
  });

  it("returns the SAME Map reference on an unrelated effect (no fold effect, no doc change)", () => {
    const state = EditorState.create({ doc: "hello", extensions: [annotationFoldField] });
    const tr1 = state.update({ effects: toggleAnnotationFoldEffect.of({ pos: 0 }) });
    const before = tr1.state.field(annotationFoldField);
    const tr2 = tr1.state.update({ effects: setThreadTurnEffect.of({ pos: 0, turn: 0 }) });
    expect(tr2.state.field(annotationFoldField)).toBe(before);
  });

  it("setAllAnnotationFoldsEffect sets multiple positions at once", () => {
    const state = EditorState.create({ doc: "hello\nworld", extensions: [annotationFoldField] });
    const tr = state.update({
      effects: setAllAnnotationFoldsEffect.of({ positions: [0, 6], collapsed: true }),
    });
    const fold = tr.state.field(annotationFoldField);
    expect(fold.get(0)).toBe(true);
    expect(fold.get(6)).toBe(true);
  });

  it("setAllAnnotationFoldsEffect overwrites existing per-position fold state", () => {
    const state = EditorState.create({ doc: "hello\nworld", extensions: [annotationFoldField] });
    const tr1 = state.update({ effects: toggleAnnotationFoldEffect.of({ pos: 0 }) });
    expect(tr1.state.field(annotationFoldField).get(0)).toBe(true);

    const tr2 = tr1.state.update({
      effects: setAllAnnotationFoldsEffect.of({ positions: [0, 6], collapsed: false }),
    });
    const fold = tr2.state.field(annotationFoldField);
    expect(fold.get(0)).toBe(false);
    expect(fold.get(6)).toBe(false);
  });

  it("positions set via setAllAnnotationFoldsEffect are remapped on doc edits", () => {
    const state = EditorState.create({ doc: "hello\nworld", extensions: [annotationFoldField] });
    const tr1 = state.update({
      effects: setAllAnnotationFoldsEffect.of({ positions: [6], collapsed: true }),
    });
    expect(tr1.state.field(annotationFoldField).get(6)).toBe(true);

    const tr2 = tr1.state.update({ changes: { from: 0, insert: "XX" } });
    const fold = tr2.state.field(annotationFoldField);
    expect(fold.get(6)).toBeUndefined();
    expect(fold.get(8)).toBe(true);
  });

  it("setAllAnnotationFoldsEffect.map remaps positions through a change", () => {
    const change = ChangeSet.of({ from: 0, insert: "XXXXX" }, 30);
    const effect = setAllAnnotationFoldsEffect.of({ positions: [10, 20], collapsed: true });
    const mapped = effect.map(change)!;
    expect(mapped.value.positions).toEqual([15, 25]);
    expect(mapped.value.collapsed).toBe(true);
  });

  it("toggleAnnotationFoldEffect.map remaps pos through a change", () => {
    const change = ChangeSet.of({ from: 0, insert: "XXXXX" }, 30);
    const effect = toggleAnnotationFoldEffect.of({ pos: 10 });
    const mapped = effect.map(change)!;
    expect(mapped.value.pos).toBe(15);
  });

  it("empty setAllAnnotationFoldsEffect preserves fold map identity", () => {
    const state = EditorState.create({ doc: "hello\nworld", extensions: [annotationFoldField] });
    const tr1 = state.update({
      effects: setAllAnnotationFoldsEffect.of({ positions: [0], collapsed: true }),
    });
    const before = tr1.state.field(annotationFoldField);
    expect(before.get(0)).toBe(true);

    const tr2 = tr1.state.update({
      effects: setAllAnnotationFoldsEffect.of({ positions: [], collapsed: true }),
    });
    expect(tr2.state.field(annotationFoldField)).toBe(before);
  });
});

describe("PillWidget click → edit event", () => {
  it("pill click dispatches lit:open-annotation-builder with edit detail", () => {
    const view = makeEditorView("hello <!---n | test---> world");
    const ann = makeAnnotation({ char_start: 6, char_end: 23, original: "<!---n | test--->" });
    const w = new PillWidget(ann);
    const dom = w.toDOM(view);

    const spy = vi.fn();
    window.addEventListener("lit:open-annotation-builder", spy);
    dom.click();
    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.mode).toBe("edit");
    expect(event.detail.annotation).toBe(ann);
    expect(event.detail.originalRange).toEqual({ from: 6, to: 23 });
    window.removeEventListener("lit:open-annotation-builder", spy);
    view.destroy();
  });
});

describe("MarkerWidget", () => {
  it("toDOM returns sup.cm-annotation-marker directly when no cardbox link exists", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "llm" }));
    const dom = w.toDOM(view);
    expect(dom.tagName).toBe("SUP");
    expect(dom.classList.contains("cm-annotation-marker")).toBe(true);
    view.destroy();
  });

  it("toDOM returns sup.cm-annotation-marker directly for non-fireable note type", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "note" }));
    const dom = w.toDOM(view);
    expect(dom.tagName).toBe("SUP");
    expect(dom.classList.contains("cm-annotation-marker")).toBe(true);
    view.destroy();
  });

  it("toDOM returns sup.cm-annotation-marker directly for bare type", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "bare" }));
    const dom = w.toDOM(view);
    expect(dom.tagName).toBe("SUP");
    expect(dom.classList.contains("cm-annotation-marker")).toBe(true);
    view.destroy();
  });

  it("renders type letter from TYPE_ICON (N for note)", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "note" }));
    const dom = w.toDOM(view);
    const sup = dom.querySelector("sup") ?? dom;
    expect(sup.textContent).toContain("N");
    view.destroy();
  });

  it("appends ? for tentative certainty", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ certainty: "tentative" }));
    const dom = w.toDOM(view);
    const sup = dom.querySelector("sup") ?? dom;
    expect(sup.textContent).toContain("?");
    view.destroy();
  });

  it("appends ! for firm certainty", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ certainty: "firm" }));
    const dom = w.toDOM(view);
    const sup = dom.querySelector("sup") ?? dom;
    expect(sup.textContent).toContain("!");
    view.destroy();
  });

  it("appends nothing for neutral certainty", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "note", certainty: "neutral" }));
    const dom = w.toDOM(view);
    const sup = dom.querySelector("sup") ?? dom;
    expect(sup.textContent).toContain("N");
    expect(sup.textContent).not.toContain("?");
    expect(sup.textContent).not.toContain("!");
    view.destroy();
  });

  it("sets data-annotation-type attribute on sup", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "question" }));
    const dom = w.toDOM(view);
    const sup = dom.querySelector("sup") ?? dom;
    expect(sup.dataset.annotationType).toBe("question");
    view.destroy();
  });

  it("adds cm-annotation-tentative class on sup", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ certainty: "tentative" }));
    const dom = w.toDOM(view);
    const sup = dom.querySelector("sup") ?? dom;
    expect(sup.classList.contains("cm-annotation-tentative")).toBe(true);
    view.destroy();
  });

  it("adds cm-annotation-firm class on sup", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ certainty: "firm" }));
    const dom = w.toDOM(view);
    const sup = dom.querySelector("sup") ?? dom;
    expect(sup.classList.contains("cm-annotation-firm")).toBe(true);
    view.destroy();
  });

  it("eq compares original + char_start + char_end", () => {
    const a = new MarkerWidget(makeAnnotation({ original: "<!---n--->", char_start: 0, char_end: 10 }));
    const b = new MarkerWidget(makeAnnotation({ original: "<!---n--->", char_start: 0, char_end: 10, body: "different" }));
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false when different", () => {
    const a = new MarkerWidget(makeAnnotation({ original: "<!---n--->", char_start: 0, char_end: 10 }));
    const b = new MarkerWidget(makeAnnotation({ original: "<!---q--->", char_start: 0, char_end: 10 }));
    expect(a.eq(b)).toBe(false);
  });

  it("ignoreEvent returns true for mousedown", () => {
    const w = new MarkerWidget(makeAnnotation());
    expect(w.ignoreEvent(new MouseEvent("mousedown"))).toBe(true);
  });

  it("ignoreEvent returns false for click", () => {
    const w = new MarkerWidget(makeAnnotation());
    expect(w.ignoreEvent(new MouseEvent("click"))).toBe(false);
  });

  it("estimatedHeight returns 14", () => {
    const w = new MarkerWidget(makeAnnotation());
    expect(w.estimatedHeight).toBe(14);
  });

  it("plain click dispatches lit:show-annotation CustomEvent with detail.charStart", () => {
    const view = makeEditorView();
    const ann = makeAnnotation({ char_start: 5 });
    const w = new MarkerWidget(ann);
    const dom = w.toDOM(view);

    const spy = vi.fn();
    window.addEventListener("lit:show-annotation", spy);
    dom.click();
    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.charStart).toBe(5);
    window.removeEventListener("lit:show-annotation", spy);
    view.destroy();
  });

  it("Mod+click dispatches lit:open-annotation-builder with edit detail", () => {
    const view = makeEditorView();
    const ann = makeAnnotation({ char_start: 5, char_end: 13 });
    const w = new MarkerWidget(ann);
    const dom = w.toDOM(view);

    const editSpy = vi.fn();
    const showSpy = vi.fn();
    window.addEventListener("lit:open-annotation-builder", editSpy);
    window.addEventListener("lit:show-annotation", showSpy);
    dom.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    expect(editSpy).toHaveBeenCalledTimes(1);
    const event = editSpy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.mode).toBe("edit");
    expect(event.detail.annotation).toBe(ann);
    expect(event.detail.originalRange).toEqual({ from: 5, to: 13 });
    expect(showSpy).not.toHaveBeenCalled();
    window.removeEventListener("lit:open-annotation-builder", editSpy);
    window.removeEventListener("lit:show-annotation", showSpy);
    view.destroy();
  });

  it("Ctrl+click dispatches lit:open-annotation-builder with edit detail", () => {
    const view = makeEditorView();
    const ann = makeAnnotation({ char_start: 5, char_end: 13 });
    const w = new MarkerWidget(ann);
    const dom = w.toDOM(view);

    const editSpy = vi.fn();
    window.addEventListener("lit:open-annotation-builder", editSpy);
    dom.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    expect(editSpy).toHaveBeenCalledTimes(1);
    window.removeEventListener("lit:open-annotation-builder", editSpy);
    view.destroy();
  });

  it("mouseenter triggers handleAnnotationHover with (view, annotation)", () => {
    const view = makeEditorView();
    const ann = makeAnnotation({ char_start: 3 });
    const w = new MarkerWidget(ann);
    const dom = w.toDOM(view);
    dom.dispatchEvent(new Event("mouseenter"));
    expect(mockHandleHover).toHaveBeenCalledOnce();
    expect(mockHandleHover).toHaveBeenCalledWith(view, ann, { altKey: undefined });
    view.destroy();
  });

  it("mouseleave triggers handleAnnotationLeave with (view, annotation)", () => {
    const view = makeEditorView();
    const ann = makeAnnotation({ char_start: 3 });
    const w = new MarkerWidget(ann);
    const dom = w.toDOM(view);
    dom.dispatchEvent(new Event("mouseleave"));
    expect(mockHandleLeave).toHaveBeenCalledOnce();
    expect(mockHandleLeave).toHaveBeenCalledWith(view, ann);
    view.destroy();
  });
});

describe("MarkerWidget mark type", () => {
  beforeEach(() => {
    useMarkConfigStore.setState({ config: { nb: { label: "nota bene", icon: "B" } }, loaded: true });
  });

  afterEach(() => {
    useMarkConfigStore.setState({ config: {}, loaded: false });
  });

  it("renders mark icon from getMarkIcon (not the generic diamond)", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "mark", mark: "nb" }));
    const dom = w.toDOM(view);
    const sup = dom.querySelector("sup") ?? dom;
    expect(sup.textContent).toContain("B");
    expect(sup.textContent).not.toContain("◆");
    view.destroy();
  });

  it("mark marker falls back to code when no config icon", () => {
    useMarkConfigStore.setState({ config: {}, loaded: true });
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "mark", mark: "sic" }));
    const dom = w.toDOM(view);
    const sup = dom.querySelector("sup") ?? dom;
    expect(sup.textContent).toContain("sic");
    view.destroy();
  });

  it("preserves certainty mark suffix alongside the mark icon", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "mark", mark: "nb", certainty: "firm" }));
    const dom = w.toDOM(view);
    const sup = dom.querySelector("sup") ?? dom;
    expect(sup.textContent).toBe("B!");
    view.destroy();
  });

  it("eq returns false when mark differs", () => {
    const a = new MarkerWidget(makeAnnotation({ annotation_type: "mark", original: "<!---*nb--->", char_start: 0, char_end: 10, mark: "nb" }));
    const b = new MarkerWidget(makeAnnotation({ annotation_type: "mark", original: "<!---*nb--->", char_start: 0, char_end: 10, mark: "sic" }));
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns true when mark matches", () => {
    const a = new MarkerWidget(makeAnnotation({ annotation_type: "mark", original: "<!---*nb--->", char_start: 0, char_end: 10, mark: "nb" }));
    const b = new MarkerWidget(makeAnnotation({ annotation_type: "mark", original: "<!---*nb--->", char_start: 0, char_end: 10, mark: "nb" }));
    expect(a.eq(b)).toBe(true);
  });
});

describe("fire UI absence (#1010)", () => {
  it("PillWidget never renders .cm-annotation-fire-btn for former fireable types", () => {
    for (const type of ["llm", "question", "translation"] as const) {
      const view = makeEditorView();
      const w = new PillWidget(makeAnnotation({ annotation_type: type, body: "x" }));
      const dom = w.toDOM(view);
      expect(dom.querySelector(".cm-annotation-fire-btn"), type).toBeNull();
      view.destroy();
    }
  });

  it("MarkerWidget never renders .cm-annotation-fire-btn for former fireable types", () => {
    for (const type of ["llm", "question", "translation"] as const) {
      const view = makeEditorView();
      const w = new MarkerWidget(makeAnnotation({ annotation_type: type }));
      const dom = w.toDOM(view);
      expect(dom.querySelector(".cm-annotation-fire-btn"), type).toBeNull();
      view.destroy();
    }
  });

  it("clicking a former-fireable pill opens the builder, never dispatches lit:fire-annotation", () => {
    const view = makeEditorView();
    const ann = makeAnnotation({ annotation_type: "llm", body: "explain" });
    const w = new PillWidget(ann);
    const dom = w.toDOM(view);

    const fireSpy = vi.fn();
    const editSpy = vi.fn();
    window.addEventListener("lit:fire-annotation", fireSpy);
    window.addEventListener("lit:open-annotation-builder", editSpy);
    dom.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(fireSpy).not.toHaveBeenCalled();
    expect(editSpy).toHaveBeenCalledTimes(1);
    window.removeEventListener("lit:fire-annotation", fireSpy);
    window.removeEventListener("lit:open-annotation-builder", editSpy);
    view.destroy();
  });
});


describe("createCardboxLinkButton", () => {
  it("returns null when uuid is missing", () => {
    expect(createCardboxLinkButton(makeAnnotation({ uuid: null }))).toBeNull();
    expect(createCardboxLinkButton(makeAnnotation({ uuid: undefined }))).toBeNull();
    expect(createCardboxLinkButton(makeAnnotation({ uuid: "" }))).toBeNull();
  });

  it("returns a span with cardbox-link class (no fire-proximity) when uuid is set", () => {
    const btn = createCardboxLinkButton(makeAnnotation({ uuid: "abc" }));
    expect(btn).toBeTruthy();
    expect(btn!.tagName).toBe("SPAN");
    expect(btn!.classList.contains("cm-annotation-cardbox-link")).toBe(true);
    expect(btn!.classList.contains("cm-annotation-fire-proximity")).toBe(false);
    expect(btn!.textContent).toBe("\u{f17f1}");
    expect(btn!.title).toBe("Show in cardbox");
  });

  it("mousedown dispatches lit:focus-cardbox-card with the uuid", () => {
    const btn = createCardboxLinkButton(makeAnnotation({ uuid: "abc" }))!;
    const spy = vi.fn();
    window.addEventListener("lit:focus-cardbox-card", spy);
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.uuid).toBe("abc");
    expect(event.detail.highlightNote).toBeFalsy();
    window.removeEventListener("lit:focus-cardbox-card", spy);
  });

  it("anchored slipnote dispatches the parent uuid with highlightNote", () => {
    const btn = createCardboxLinkButton(
      makeAnnotation({
        uuid: "sn-child",
        annotation_type: "slipnote",
        scope: { kind: "anchor", value: "parent-1" },
      }),
    )!;
    const spy = vi.fn();
    window.addEventListener("lit:focus-cardbox-card", spy);
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.uuid).toBe("parent-1");
    expect(event.detail.highlightNote).toBe(true);
    window.removeEventListener("lit:focus-cardbox-card", spy);
  });

  // An empty anchor value would otherwise dispatch uuid "" (a dead click:
  // no card matches). Fall back to the slip-note's own card instead.
  it("anchored slipnote with an empty anchor value falls back to its own uuid", () => {
    const btn = createCardboxLinkButton(
      makeAnnotation({
        uuid: "sn-child",
        annotation_type: "slipnote",
        scope: { kind: "anchor", value: "" },
      }),
    )!;
    const spy = vi.fn();
    window.addEventListener("lit:focus-cardbox-card", spy);
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.uuid).toBe("sn-child");
    expect(event.detail.highlightNote).toBe(false);
    window.removeEventListener("lit:focus-cardbox-card", spy);
  });

  it("non-anchored slipnote dispatches its own uuid without highlightNote", () => {
    const btn = createCardboxLinkButton(
      makeAnnotation({
        uuid: "sn-orphan",
        annotation_type: "slipnote",
        scope: { kind: "paragraph", value: 1 },
      }),
    )!;
    const spy = vi.fn();
    window.addEventListener("lit:focus-cardbox-card", spy);
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.uuid).toBe("sn-orphan");
    expect(event.detail.highlightNote).toBeFalsy();
    window.removeEventListener("lit:focus-cardbox-card", spy);
  });

  it("mousedown calls preventDefault and stopPropagation", () => {
    const btn = createCardboxLinkButton(makeAnnotation({ uuid: "abc" }))!;
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    const stopSpy = vi.spyOn(event, "stopPropagation");
    btn.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(stopSpy).toHaveBeenCalled();
  });
});

describe("PillWidget cardbox link", () => {
  it("renders the cardbox link in the pill when uuid is set", () => {
    const view = makeEditorView();
    const w = new PillWidget(makeAnnotation({ body: "body", uuid: "abc" }));
    const dom = w.toDOM(view);
    expect(dom.querySelector(".cm-annotation-cardbox-link")).toBeTruthy();
    view.destroy();
  });

  it("does NOT render the cardbox link when uuid is missing", () => {
    const view = makeEditorView();
    const w = new PillWidget(makeAnnotation({ body: "body" }));
    const dom = w.toDOM(view);
    expect(dom.querySelector(".cm-annotation-cardbox-link")).toBeNull();
    view.destroy();
  });

  it("click on cardbox link does NOT dispatch edit event", () => {
    const view = makeEditorView("hello <!---n | test---> world");
    const ann = makeAnnotation({ char_start: 6, char_end: 23, original: "<!---n | test--->", uuid: "abc" });
    const w = new PillWidget(ann);
    const dom = w.toDOM(view);

    const spy = vi.fn();
    window.addEventListener("lit:open-annotation-builder", spy);
    const btn = dom.querySelector(".cm-annotation-cardbox-link")! as HTMLElement;
    btn.click();
    expect(spy).not.toHaveBeenCalled();
    window.removeEventListener("lit:open-annotation-builder", spy);
    view.destroy();
  });

  it("eq returns false when uuid differs", () => {
    const a = new PillWidget(makeAnnotation({ uuid: "abc" }));
    const b = new PillWidget(makeAnnotation({ uuid: "xyz" }));
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns true when uuid matches", () => {
    const a = new PillWidget(makeAnnotation({ uuid: "abc" }));
    const b = new PillWidget(makeAnnotation({ uuid: "abc" }));
    expect(a.eq(b)).toBe(true);
  });
});

describe("MarkerWidget cardbox link", () => {
  it("renders the cardbox link in the wrap when uuid is set", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "llm", uuid: "abc" }));
    const dom = w.toDOM(view);
    expect(dom.classList.contains("cm-annotation-marker-wrap")).toBe(true);
    expect(dom.querySelector(".cm-annotation-cardbox-link")).toBeTruthy();
    view.destroy();
  });

  it("renders the cardbox link inside a wrap for a non-fireable note type when uuid is set", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "note", uuid: "abc" }));
    const dom = w.toDOM(view);
    expect(dom.classList.contains("cm-annotation-marker-wrap")).toBe(true);
    expect(dom.querySelector(".cm-annotation-cardbox-link")).toBeTruthy();
    expect(dom.querySelector("sup.cm-annotation-marker")).toBeTruthy();
    view.destroy();
  });

  it("renders a bare sup for a non-fireable note type without uuid", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "note" }));
    const dom = w.toDOM(view);
    expect(dom.tagName).toBe("SUP");
    expect(dom.querySelector(".cm-annotation-cardbox-link")).toBeNull();
    view.destroy();
  });

  it("does NOT render the cardbox link when uuid is missing (fireable type)", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "llm" }));
    const dom = w.toDOM(view);
    expect(dom.querySelector(".cm-annotation-cardbox-link")).toBeNull();
    view.destroy();
  });

  it("click on cardbox link does NOT dispatch lit:show-annotation", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "note", uuid: "abc" }));
    const dom = w.toDOM(view);

    const spy = vi.fn();
    window.addEventListener("lit:show-annotation", spy);
    const btn = dom.querySelector(".cm-annotation-cardbox-link")! as HTMLElement;
    btn.click();
    expect(spy).not.toHaveBeenCalled();
    window.removeEventListener("lit:show-annotation", spy);
    view.destroy();
  });

  it("eq returns false when uuid differs", () => {
    const a = new MarkerWidget(makeAnnotation({ uuid: "abc" }));
    const b = new MarkerWidget(makeAnnotation({ uuid: "xyz" }));
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns true when uuid matches", () => {
    const a = new MarkerWidget(makeAnnotation({ uuid: "abc" }));
    const b = new MarkerWidget(makeAnnotation({ uuid: "abc" }));
    expect(a.eq(b)).toBe(true);
  });
});

describe("rendered body markdown (expanded thread + pills)", () => {
  // The expanded ThreadWidget body is the only remaining renderMarkdown consumer
  // in the editor (CalloutWidget is gone); this coverage anchors there.
  function makeThreadWithResponse(response: string): Annotation {
    return makeAnnotation({
      form: "block",
      annotation_type: "thread",
      body: `[q]: The question?\n\n${response}`,
      char_start: 0,
      char_end: 5,
      original: "block-thread",
    });
  }

  it("renders response as HTML via renderMarkdown when expanded", () => {
    const w = new ThreadWidget(makeThreadWithResponse("**bold** text"), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const bodyEl = dom.querySelector(".cm-annotation-callout-body")!;
    expect(bodyEl.innerHTML).toContain("<strong>bold</strong>");
    expect(bodyEl.innerHTML).toContain("text");
  });

  it("sanitizes HTML in response to prevent XSS", () => {
    const w = new ThreadWidget(
      makeThreadWithResponse('<script>alert("xss")</script>Safe text'),
      0,
      false,
      0,
    );
    const dom = w.toDOM(null as unknown as EditorView);
    const bodyEl = dom.querySelector(".cm-annotation-callout-body")!;
    expect(bodyEl.innerHTML).not.toContain("<script>");
    expect(bodyEl.innerHTML).toContain("Safe text");
  });

  it("renders markdown headings in response", () => {
    const w = new ThreadWidget(makeThreadWithResponse("# Heading\n\nParagraph text"), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const bodyEl = dom.querySelector(".cm-annotation-callout-body")!;
    expect(bodyEl.querySelector("h1")).toBeTruthy();
    expect(bodyEl.querySelector("h1")!.textContent).toBe("Heading");
  });

  it("renders markdown lists in response", () => {
    const w = new ThreadWidget(makeThreadWithResponse("- item one\n- item two"), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const bodyEl = dom.querySelector(".cm-annotation-callout-body")!;
    expect(bodyEl.innerHTML).toContain("<li>");
    expect(bodyEl.innerHTML).toContain("item one");
  });

  it("pill body renders inline markdown as HTML", () => {
    const view = makeEditorView();
    const ann = makeAnnotation({ body: "**bold** and *italic*" });
    const w = new PillWidget(ann);
    const dom = w.toDOM(view);
    const bodyEl = dom.querySelector(".cm-annotation-pill-body")!;
    expect(bodyEl.innerHTML).toContain("<strong>bold</strong>");
    expect(bodyEl.innerHTML).toContain("<em>italic</em>");
    view.destroy();
  });

  it("renders footnotes in the thread response body", () => {
    const w = new ThreadWidget(
      makeThreadWithResponse("text[^1] here\n\n[^1]: the footnote"),
      0,
      false,
      0,
    );
    const dom = w.toDOM(null as unknown as EditorView);
    const bodyEl = dom.querySelector(".cm-annotation-callout-body")!;
    expect(bodyEl.querySelector("sup a[data-footnote-ref]")).toBeTruthy();
    const section = bodyEl.querySelector("section.footnotes");
    expect(section).toBeTruthy();
    expect(section!.textContent).toContain("the footnote");
  });

  it("pill body shows sup footnote markers and strips definitions", () => {
    const view = makeEditorView();
    const ann = makeAnnotation({ body: "see[^1] end\n[^1]: hidden def" });
    const w = new PillWidget(ann);
    const dom = w.toDOM(view);
    const bodyEl = dom.querySelector(".cm-annotation-pill-body")!;
    const sup = bodyEl.querySelector("sup.footnote-ref");
    expect(sup).toBeTruthy();
    expect(sup!.textContent).toBe("1");
    expect(bodyEl.querySelector("sup.footnote-ref a")).toBeNull();
    expect(bodyEl.textContent).not.toContain("hidden def");
    view.destroy();
  });

  it("clicking a footnote ref in the thread response body prevents default navigation", () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const w = new ThreadWidget(
      makeThreadWithResponse("text[^1] here\n\n[^1]: the footnote"),
      0,
      false,
      0,
    );
    const dom = w.toDOM(null as unknown as EditorView);
    const ref = dom.querySelector("sup a[data-footnote-ref]")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    ref.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(scrollSpy).toHaveBeenCalled();
  });
});

describe("threadTurnField", () => {
  it("initial state is an empty Map", () => {
    const state = EditorState.create({ extensions: [threadTurnField] });
    expect(state.field(threadTurnField).size).toBe(0);
  });

  it("setThreadTurnEffect sets the turn for a position", () => {
    const state = EditorState.create({ doc: "hello world", extensions: [threadTurnField] });
    const tr = state.update({ effects: setThreadTurnEffect.of({ pos: 5, turn: 2 }) });
    expect(tr.state.field(threadTurnField).get(5)).toBe(2);
  });

  it("remaps positions on document change while preserving the turn value", () => {
    const state = EditorState.create({ doc: "hello world", extensions: [threadTurnField] });
    const tr1 = state.update({ effects: setThreadTurnEffect.of({ pos: 10, turn: 3 }) });
    const tr2 = tr1.state.update({ changes: { from: 0, to: 0, insert: "XX" } });
    const field = tr2.state.field(threadTurnField);
    expect(field.get(10)).toBeUndefined();
    expect(field.get(12)).toBe(3);
  });

  it("returns the identical Map reference on a no-effect, no-docChange transaction", () => {
    const state = EditorState.create({ doc: "hello world", extensions: [threadTurnField] });
    const tr1 = state.update({ effects: setThreadTurnEffect.of({ pos: 5, turn: 1 }) });
    const before = tr1.state.field(threadTurnField);
    const tr2 = tr1.state.update({ selection: { anchor: 2 } });
    expect(tr2.state.field(threadTurnField)).toBe(before);
  });

  it("returns the SAME Map reference on an unrelated effect (no turn effect, no doc change)", () => {
    const state = EditorState.create({ doc: "hello world", extensions: [threadTurnField, annotationFoldField] });
    const tr1 = state.update({ effects: setThreadTurnEffect.of({ pos: 5, turn: 1 }) });
    const before = tr1.state.field(threadTurnField);
    const tr2 = tr1.state.update({ effects: toggleAnnotationFoldEffect.of({ pos: 0 }) });
    expect(tr2.state.field(threadTurnField)).toBe(before);
  });
});

describe("ThreadWidget", () => {
  const TWO_TURN_BODY =
    "[q]: First question?\n\nFirst **response** body.\n\n[q]: Second question?\n\nSecond response body.";
  const ONE_TURN_BODY = "[q]: Only question?\n\nOnly response.";

  function makeThread(overrides: Partial<Annotation> = {}): Annotation {
    return makeAnnotation({
      form: "block",
      annotation_type: "thread",
      body: TWO_TURN_BODY,
      char_start: 0,
      char_end: 40,
      original: "block-thread",
      ...overrides,
    });
  }

  it("toDOM returns div.cm-annotation-callout with thread type + cm-thread marker", () => {
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView) as HTMLElement;
    expect(dom.tagName).toBe("DIV");
    expect(dom.classList.contains("cm-annotation-callout")).toBe(true);
    expect(dom.classList.contains("cm-thread")).toBe(true);
    expect(dom.dataset.annotationType).toBe("thread");
  });

  it("renders header icon, label 'thread', and turn counter 1/2 at turn 0", () => {
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const header = dom.querySelector(".cm-annotation-callout-header")!;
    expect(header.querySelector(".cm-annotation-pill-icon")!.textContent).toBe("◇");
    expect(header.querySelector(".cm-annotation-callout-label")!.textContent).toBe("thread");
    expect(header.querySelector(".cm-thread-turn-counter")!.textContent).toBe("1/2");
  });

  it("shows ◁▷ nav arrows when more than one turn", () => {
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    expect(dom.querySelectorAll(".cm-thread-nav-arrow").length).toBe(2);
  });

  it("hides ◁▷ nav arrows when exactly one turn", () => {
    const w = new ThreadWidget(makeThread({ body: ONE_TURN_BODY }), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    expect(dom.querySelectorAll(".cm-thread-nav-arrow").length).toBe(0);
    expect(dom.querySelector(".cm-thread-turn-counter")!.textContent).toBe("1/1");
  });

  it("renders active turn question as textContent (not markdown) and response via renderMarkdown", () => {
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const question = dom.querySelector(".cm-thread-question")!;
    expect(question.textContent).toBe("First question?");
    const body = dom.querySelector(".cm-annotation-callout-body")!;
    expect(body.innerHTML).toContain("<strong>response</strong>");
  });

  it("renders the second turn content when turn index is 1", () => {
    const w = new ThreadWidget(makeThread(), 1, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    expect(dom.querySelector(".cm-thread-question")!.textContent).toBe("Second question?");
    expect(dom.querySelector(".cm-thread-turn-counter")!.textContent).toBe("2/2");
    expect(dom.querySelector(".cm-annotation-callout-body")!.textContent).toContain("Second response body.");
  });

  it("renders an empty/placeholder state and no body or follow-up trigger when the thread body is whitespace-only", () => {
    const w = new ThreadWidget(makeThread({ body: "   \n  \n" }), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    expect(dom.querySelector(".cm-annotation-callout-body")).toBeNull();
    expect(dom.querySelector(".cm-thread-followup-trigger")).toBeNull();
    expect(dom.querySelector(".cm-thread-empty")).toBeTruthy();
    expect(dom.querySelector(".cm-thread-question")).toBeNull();
    expect(dom.querySelector(".cm-thread-turn-counter")).toBeNull();
    expect(dom.querySelectorAll(".cm-thread-nav-arrow").length).toBe(0);
  });

  it("keeps estimatedHeight positive for an empty expanded thread", () => {
    const w = new ThreadWidget(makeThread({ body: "" }), 0, false, 0);
    expect(w.estimatedHeight).toBeGreaterThan(0);
  });

  it("collapsed thread renders a pill, not a callout", () => {
    const w = new ThreadWidget(makeThread(), 0, true, 0);
    const dom = w.toDOM(null as unknown as EditorView) as HTMLElement;
    expect(dom.tagName).toBe("SPAN");
    expect(dom.classList.contains("cm-annotation-pill")).toBe(true);
    expect(dom.classList.contains("cm-thread")).toBe(true);
    expect(dom.classList.contains("cm-annotation-callout")).toBe(false);
    expect(dom.dataset.annotationType).toBe("thread");
    // No callout chrome, no thread chrome.
    expect(dom.querySelector(".cm-annotation-callout-header")).toBeNull();
    expect(dom.querySelector(".cm-annotation-callout-label")).toBeNull();
    expect(dom.querySelector(".cm-annotation-callout-body")).toBeNull();
    expect(dom.querySelector(".cm-thread-question")).toBeNull();
    expect(dom.querySelector(".cm-thread-turn-counter")).toBeNull();
    expect(dom.querySelector(".cm-thread-nav")).toBeNull();
    expect(dom.querySelector(".cm-thread-nav-arrow")).toBeNull();
    expect(dom.querySelector(".cm-thread-overflow")).toBeNull();
    expect(dom.querySelector(".cm-thread-followup-trigger")).toBeNull();
    expect(dom.querySelector(".cm-annotation-fire-btn")).toBeNull();
    expect(dom.querySelector(".cm-annotation-spinner")).toBeNull();
    // Pill contents: icon + truncated question + expand chevron.
    expect(dom.querySelector(".cm-annotation-pill-icon")!.textContent).toBe("◇");
    expect(dom.querySelector(".cm-annotation-pill-body")!.textContent).toBe("First question?");
    const chevron = dom.querySelector(".cm-annotation-fold-icon")!;
    expect(chevron.classList.contains("is-collapsed")).toBe(true);
    expect(chevron.querySelector("svg")).toBeTruthy();
  });




  it("collapsed pill adds the certainty class", () => {
    const w = new ThreadWidget(makeThread({ certainty: "tentative" }), 0, true, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    expect(dom.classList.contains("cm-annotation-tentative")).toBe(true);
  });

  it("collapsed pill shows the active-turn question per turn index", () => {
    const w = new ThreadWidget(makeThread(), 1, true, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    expect(dom.querySelector(".cm-annotation-pill-body")!.textContent).toBe("Second question?");
  });

  it("collapsed pill falls back to the response when the question is empty", () => {
    const w = new ThreadWidget(makeThread({ body: "Just a response, no [q] marker." }), 0, true, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    expect(dom.querySelector(".cm-annotation-pill-body")!.textContent).toBe(
      "Just a response, no [q] marker.",
    );
  });

  it("collapsed pill omits the body element when the thread is empty", () => {
    const w = new ThreadWidget(makeThread({ body: "   \n  \n" }), 0, true, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    expect(dom.querySelector(".cm-annotation-pill-body")).toBeNull();
    expect(dom.querySelector(".cm-annotation-pill-icon")).toBeTruthy();
    expect(dom.querySelector(".cm-annotation-fold-icon")).toBeTruthy();
  });

  it("collapsed pill truncates the question at 60 chars", () => {
    const longQ = "q".repeat(80);
    const w = new ThreadWidget(makeThread({ body: `[q]: ${longQ}\n\nresp` }), 0, true, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const text = dom.querySelector(".cm-annotation-pill-body")!.textContent!;
    expect(text.length).toBe(61);
    expect(text.endsWith("…")).toBe(true);
  });

  it("collapsed pill renders the question as textContent, never markup", () => {
    const w = new ThreadWidget(
      makeThread({ body: '[q]: <img src=x onerror="alert(1)">\n\nresp' }),
      0,
      true,
      0,
    );
    const dom = w.toDOM(null as unknown as EditorView);
    const bodyEl = dom.querySelector(".cm-annotation-pill-body")!;
    expect(bodyEl.querySelector("img")).toBeNull();
    expect(bodyEl.textContent).toContain("<img");
  });

  it("collapsed pill shows the cardbox link iff uuid is set", () => {
    const withUuid = new ThreadWidget(makeThread({ uuid: "abc" }), 0, true, 0);
    expect(
      withUuid.toDOM(null as unknown as EditorView).querySelector(".cm-annotation-cardbox-link"),
    ).toBeTruthy();
    const withoutUuid = new ThreadWidget(makeThread(), 0, true, 0);
    expect(
      withoutUuid.toDOM(null as unknown as EditorView).querySelector(".cm-annotation-cardbox-link"),
    ).toBeNull();
  });

  it("collapsed pill chevron mousedown dispatches toggleAnnotationFoldEffect at pos", () => {
    const view = makeEditorView("x".repeat(50));
    const w = new ThreadWidget(makeThread(), 0, true, 7);
    const dom = w.toDOM(view);
    const spy = vi.spyOn(view, "dispatch");
    const chevron = dom.querySelector(".cm-annotation-fold-icon")! as HTMLElement;
    chevron.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(spy).toHaveBeenCalled();
    const effects = (spy.mock.calls[0]![0] as { effects: ReturnType<typeof toggleAnnotationFoldEffect.of> }).effects;
    expect(effects.is(toggleAnnotationFoldEffect)).toBe(true);
    expect(effects.value).toEqual({ pos: 7 });
    view.destroy();
  });

  it("collapsed pill click dispatches edit event, but chevron/cardbox clicks do not", () => {
    const view = makeEditorView("x".repeat(50));
    const ann = makeThread({ uuid: "abc" });
    const w = new ThreadWidget(ann, 0, true, 0);
    const dom = w.toDOM(view);
    const spy = vi.fn();
    window.addEventListener("lit:open-annotation-builder", spy);

    (dom.querySelector(".cm-annotation-pill-body")! as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]![0] as CustomEvent).detail.annotation).toBe(ann);

    spy.mockClear();
    (dom.querySelector(".cm-annotation-fold-icon")! as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    (dom.querySelector(".cm-annotation-cardbox-link")! as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(spy).not.toHaveBeenCalled();

    window.removeEventListener("lit:open-annotation-builder", spy);
    view.destroy();
  });

  it("collapsed pill wires hover and leave handlers", () => {
    const view = makeEditorView("x".repeat(50));
    const ann = makeThread();
    const w = new ThreadWidget(ann, 0, true, 0);
    const dom = w.toDOM(view);
    dom.dispatchEvent(new Event("mouseenter"));
    expect(mockHandleHover).toHaveBeenCalledWith(view, ann, { altKey: undefined });
    dom.dispatchEvent(new Event("mouseleave"));
    expect(mockHandleLeave).toHaveBeenCalledWith(view, ann);
    view.destroy();
  });

  it("estimatedHeight is 20 collapsed and greater than 20 expanded", () => {
    const collapsed = new ThreadWidget(makeThread(), 0, true, 0);
    const expanded = new ThreadWidget(makeThread(), 0, false, 0);
    expect(collapsed.estimatedHeight).toBe(20);
    expect(expanded.estimatedHeight).toBeGreaterThan(20);
  });

  it("collapsed pill contains no follow-up textarea", () => {
    const w = new ThreadWidget(makeThread(), 0, true, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    expect(dom.querySelector(".cm-thread-followup-input")).toBeNull();
    expect(dom.querySelector("textarea")).toBeNull();
  });

  it("expanded toDOM after a collapse round-trip yields exactly one callout body", () => {
    // Fold flips go through destroy + toDOM (updateDOM is gone); a fresh
    // expanded toDOM must always produce a single clean body.
    const ann = makeThread();
    const collapsedDom = new ThreadWidget(ann, 0, true, 0).toDOM(null as unknown as EditorView);
    expect(collapsedDom.querySelector(".cm-annotation-callout-body")).toBeNull();
    const expandedDom = new ThreadWidget(ann, 0, false, 0).toDOM(null as unknown as EditorView);
    expect(expandedDom.querySelectorAll(".cm-annotation-callout-body").length).toBe(1);
    expect(expandedDom.querySelectorAll(".cm-thread-followup-trigger").length).toBe(0);
    expect(expandedDom.querySelectorAll(".cm-thread-followup-input").length).toBe(0);
  });

  it("no updateDOM: collapsed/expanded DOM shapes differ structurally, fold flips go through toDOM", () => {
    expect(Object.prototype.hasOwnProperty.call(ThreadWidget.prototype, "updateDOM")).toBe(false);
  });

  it("clamps an out-of-range turn index without throwing", () => {
    const w = new ThreadWidget(makeThread(), 9, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    expect(dom.querySelector(".cm-thread-turn-counter")!.textContent).toBe("2/2");
    expect(dom.querySelector(".cm-thread-question")!.textContent).toBe("Second question?");
  });

  it("clicking ▷ dispatches setThreadTurnEffect with the incremented clamped turn", () => {
    const view = makeEditorView("x".repeat(50));
    const w = new ThreadWidget(makeThread(), 0, false, 7);
    const dom = w.toDOM(view);
    const arrows = dom.querySelectorAll(".cm-thread-nav-arrow");
    const next = arrows[arrows.length - 1] as HTMLElement;
    const spy = vi.spyOn(view, "dispatch");
    next.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(spy).toHaveBeenCalled();
    const effects = (spy.mock.calls[0]![0] as { effects: unknown }).effects as ReturnType<typeof setThreadTurnEffect.of>;
    expect(effects.is(setThreadTurnEffect)).toBe(true);
    expect((effects.value as { pos: number; turn: number })).toEqual({ pos: 7, turn: 1 });
    view.destroy();
  });

  it("clicking ◁ at turn 0 does not go negative", () => {
    const view = makeEditorView("x".repeat(50));
    const w = new ThreadWidget(makeThread(), 0, false, 7);
    const dom = w.toDOM(view);
    const prev = dom.querySelector(".cm-thread-nav-arrow")! as HTMLElement;
    const spy = vi.spyOn(view, "dispatch");
    prev.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const effects = (spy.mock.calls[0]![0] as { effects: ReturnType<typeof setThreadTurnEffect.of> }).effects;
    expect((effects.value as { pos: number; turn: number }).turn).toBe(0);
    view.destroy();
  });



  it("does NOT render a fire button (threads are not fireable)", () => {
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    expect(dom.querySelector(".cm-annotation-fire-btn")).toBeNull();
  });








  it("overflow menu 'Export thread' dispatches lit:thread-export with turn -1", () => {
    const ann = makeThread();
    const w = new ThreadWidget(ann, 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const rows = dom.querySelectorAll(".cm-thread-overflow-menu > *");
    const exportThread = Array.from(rows).find((r) => r.textContent === "Export thread")! as HTMLElement;
    const spy = vi.fn();
    window.addEventListener("lit:thread-export", spy);
    exportThread.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const event = spy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.annotation).toBe(ann);
    expect(event.detail.turn).toBe(-1);
    window.removeEventListener("lit:thread-export", spy);
  });

  it("overflow menu 'Export turn' dispatches lit:thread-export with the active turn index", () => {
    const ann = makeThread();
    const w = new ThreadWidget(ann, 1, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const rows = dom.querySelectorAll(".cm-thread-overflow-menu > *");
    const exportTurn = Array.from(rows).find((r) => r.textContent === "Export turn")! as HTMLElement;
    const spy = vi.fn();
    window.addEventListener("lit:thread-export", spy);
    exportTurn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const event = spy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.turn).toBe(1);
    window.removeEventListener("lit:thread-export", spy);
  });

  it("overflow menu 'Delete' dispatches lit:thread-delete with the annotation", () => {
    const ann = makeThread();
    const w = new ThreadWidget(ann, 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const rows = dom.querySelectorAll(".cm-thread-overflow-menu > *");
    const del = Array.from(rows).find((r) => r.textContent === "Delete")! as HTMLElement;
    const spy = vi.fn();
    window.addEventListener("lit:thread-delete", spy);
    del.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const event = spy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.annotation).toBe(ann);
    // No view → no live range can be resolved; deleteThread falls back to offsets.
    expect(event.detail.range).toBeUndefined();
    window.removeEventListener("lit:thread-delete", spy);
  });

  it("header click dispatches edit event, but nav/fold/overflow/followup clicks do not", () => {
    const view = makeEditorView("x".repeat(50));
    const ann = makeThread();
    const w = new ThreadWidget(ann, 0, false, 0);
    const dom = w.toDOM(view);
    const spy = vi.fn();
    window.addEventListener("lit:open-annotation-builder", spy);

    dom.querySelector(".cm-annotation-callout-label")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockClear();
    (dom.querySelector(".cm-thread-nav-arrow")! as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    (dom.querySelector(".cm-annotation-fold-icon")! as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    (dom.querySelector(".cm-thread-overflow")! as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(spy).not.toHaveBeenCalled();

    window.removeEventListener("lit:open-annotation-builder", spy);
    view.destroy();
  });

  it("eq returns false when turn differs and true when all fields match", () => {
    const ann = makeThread();
    expect(new ThreadWidget(ann, 0, false, 0).eq(new ThreadWidget(ann, 1, false, 0))).toBe(false);
    expect(new ThreadWidget(ann, 0, false, 0).eq(new ThreadWidget(ann, 0, true, 0))).toBe(false);
    expect(new ThreadWidget(ann, 0, false, 0).eq(new ThreadWidget(ann, 0, false, 0))).toBe(true);
  });

  it("clicking ⋮ adds is-open; clicking again removes it", () => {
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const overflow = dom.querySelector(".cm-thread-overflow")! as HTMLElement;
    overflow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(overflow.classList.contains("is-open")).toBe(true);
    overflow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(overflow.classList.contains("is-open")).toBe(false);
  });

  it("Escape keydown on document closes the menu and is preventDefault-ed", () => {
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const overflow = dom.querySelector(".cm-thread-overflow")! as HTMLElement;
    overflow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(overflow.classList.contains("is-open")).toBe(true);

    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(esc);
    expect(overflow.classList.contains("is-open")).toBe(false);
    expect(esc.defaultPrevented).toBe(true);
  });

  it("mousedown outside the overflow element closes the menu", () => {
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    document.body.appendChild(dom);
    const overflow = dom.querySelector(".cm-thread-overflow")! as HTMLElement;
    overflow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(overflow.classList.contains("is-open")).toBe(true);

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(overflow.classList.contains("is-open")).toBe(false);
    dom.remove();
  });

  it("non-Escape keystrokes are preventDefault-ed and stopPropagation-ed while menu is open", () => {
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const overflow = dom.querySelector(".cm-thread-overflow")! as HTMLElement;
    overflow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    const key = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    const stopSpy = vi.spyOn(key, "stopPropagation");
    document.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(stopSpy).toHaveBeenCalled();
    expect(overflow.classList.contains("is-open")).toBe(true);
    w.destroy(dom);
  });

  it("menu row click closes the menu", () => {
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const overflow = dom.querySelector(".cm-thread-overflow")! as HTMLElement;
    overflow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(overflow.classList.contains("is-open")).toBe(true);

    const row = dom.querySelector(".cm-thread-overflow-row")! as HTMLElement;
    row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(overflow.classList.contains("is-open")).toBe(false);
  });

  it("container mouseleave skips handleAnnotationLeave when menu is open", () => {
    const view = makeEditorView("x".repeat(50));
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    const dom = w.toDOM(view);
    const overflow = dom.querySelector(".cm-thread-overflow")! as HTMLElement;

    overflow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    mockHandleLeave.mockClear();
    dom.dispatchEvent(new Event("mouseleave"));
    expect(mockHandleLeave).not.toHaveBeenCalled();

    // After closing the menu, mouseleave should work again.
    overflow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    dom.dispatchEvent(new Event("mouseleave"));
    expect(mockHandleLeave).toHaveBeenCalledOnce();
    expect(mockHandleLeave).toHaveBeenCalledWith(view, makeThread());
    view.destroy();
  });

  it("ignoreEvent returns true for mousedown only", () => {
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    expect(w.ignoreEvent(new MouseEvent("mousedown"))).toBe(true);
    expect(w.ignoreEvent(new MouseEvent("click"))).toBe(false);
    expect(w.ignoreEvent(new KeyboardEvent("keydown", { bubbles: true }))).toBe(false);
    expect(w.ignoreEvent(new Event("paste", { bubbles: true }))).toBe(false);
  });

  it("destroy closes an open overflow menu and releases the document keydown trap", () => {
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const overflow = dom.querySelector(".cm-thread-overflow")! as HTMLElement;

    overflow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(overflow.classList.contains("is-open")).toBe(true);

    w.destroy(dom);

    expect(overflow.classList.contains("is-open")).toBe(false);

    const key = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    document.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);

    const click = new MouseEvent("mousedown", { bubbles: true });
    expect(() => document.dispatchEvent(click)).not.toThrow();
  });

  it("destroy with menu closed is a no-op", () => {
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);

    expect(() => w.destroy(dom)).not.toThrow();

    const key = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    document.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
  });
});

describe("fold-driven menu cleanup (Phase 6)", () => {
  it("destroy on a fold flip closes the overflow menu and removes document listeners", () => {
    // Fold flips go through destroy + toDOM (no updateDOM): CM6 destroys the
    // non-reused expanded tile, which must close an open overflow menu.
    const view = makeEditorView();
    const ann = makeAnnotation({
      annotation_type: "thread",
      body: "[q]: Question?\n\nAnswer text.",
    });
    const expanded = new ThreadWidget(ann, 0, false, 0);
    const dom = expanded.toDOM(view);

    const overflow = dom.querySelector(`.${CLS.THREAD_OVERFLOW}`)! as HTMLElement;
    overflow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(overflow.classList.contains(CLS.IS_OPEN)).toBe(true);

    // Verify keydown IS trapped while menu is open (sanity baseline).
    const keyBefore = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    document.dispatchEvent(keyBefore);
    expect(keyBefore.defaultPrevented).toBe(true);

    expanded.destroy(dom);

    expect(overflow.classList.contains(CLS.IS_OPEN)).toBe(false);

    // The keydown trap must be released after destroy.
    const keyAfter = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    document.dispatchEvent(keyAfter);
    expect(keyAfter.defaultPrevented).toBe(false);

    // The outside-click handler must also be gone (no throw, menu stays closed).
    const outsideClick = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(outsideClick);
    expect(overflow.classList.contains(CLS.IS_OPEN)).toBe(false);

    view.destroy();
  });

  // The chevron path needs no fix: the capture-phase outside-click handler on
  // `document` fires before the fold effect is dispatched by the chevron's
  // mousedown, so `closeMenu()` runs first and the menu is already gone.
});

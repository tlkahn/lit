import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { PillWidget, CalloutWidget, MarkerWidget, ThreadWidget, toggleAnnotationFoldEffect, annotationFoldField, threadTurnField, setThreadTurnEffect, firingAnnotationsField, setFiringAnnotation, clearFiringAnnotation, createFireButton, llmLockedField, setLlmLockedEffect } from "./annotationWidgets";
import type { Annotation } from "../../lib/ipc";
import { useModalLockStore } from "../../stores/modalLock";
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
  useModalLockStore.setState({ llmLocked: false });
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

  it("renders type icon, body, and date", () => {
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
    expect(dom.querySelector(".cm-annotation-date")!.textContent).toBe("2026-04");
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

  it("mouseleave triggers handleAnnotationLeave with (view)", () => {
    const view = makeEditorView();
    const w = new PillWidget(makeAnnotation());
    const dom = w.toDOM(view);
    dom.dispatchEvent(new Event("mouseleave"));
    expect(mockHandleLeave).toHaveBeenCalledOnce();
    expect(mockHandleLeave).toHaveBeenCalledWith(view);
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
});

describe("CalloutWidget", () => {
  it("toDOM returns div.cm-annotation-callout", () => {
    const ann = makeAnnotation({
      form: "block",
      body: "body",
      char_start: 0,
      char_end: 18,
      original: "<!---\nn!\n---\nbody\n--->",
    });
    const w = new CalloutWidget(ann, false, 0);
    const dom = w.toDOM(null as unknown as import("@codemirror/view").EditorView);
    expect(dom.tagName).toBe("DIV");
    expect(dom.classList.contains("cm-annotation-callout")).toBe(true);
  });

  it("renders header with type label and fold toggle", () => {
    const ann = makeAnnotation({
      form: "block",
      annotation_type: "question",
      certainty: "firm",
      body: "some question",
      date: "2026-05",
      char_start: 0,
      char_end: 5,
      original: "block",
    });
    const w = new CalloutWidget(ann, false, 0);
    const dom = w.toDOM(null as unknown as import("@codemirror/view").EditorView);
    const header = dom.querySelector(".cm-annotation-callout-header")!;
    expect(header.querySelector(".cm-annotation-callout-label")!.textContent).toBe("question");
    expect(header.querySelector(".cm-annotation-date")!.textContent).toBe("2026-05");
    expect(header.querySelector(".cm-annotation-fold-icon")).toBeTruthy();
  });

  it("hides body when collapsed", () => {
    const ann = makeAnnotation({
      form: "block",
      body: "hidden body",
      char_start: 0,
      char_end: 4,
      original: "coll",
    });
    const w = new CalloutWidget(ann, true, 0);
    const dom = w.toDOM(null as unknown as import("@codemirror/view").EditorView);
    expect(dom.querySelector(".cm-annotation-callout-body")).toBeNull();
  });

  it("estimatedHeight differs by collapse state", () => {
    const ann = makeAnnotation();
    const expanded = new CalloutWidget(ann, false, 0);
    const collapsed = new CalloutWidget(ann, true, 0);
    expect(expanded.estimatedHeight).toBeGreaterThan(collapsed.estimatedHeight);
  });

  it("ignoreEvent returns true for mousedown", () => {
    const w = new CalloutWidget(makeAnnotation(), false, 0);
    expect(w.ignoreEvent(new MouseEvent("mousedown"))).toBe(true);
  });

  it("ignoreEvent returns false for click", () => {
    const w = new CalloutWidget(makeAnnotation(), false, 0);
    expect(w.ignoreEvent(new MouseEvent("click"))).toBe(false);
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

describe("CalloutWidget click → edit event", () => {
  it("header click dispatches lit:open-annotation-builder with edit detail", () => {
    const view = makeEditorView("hello <!---n\n---\nbody\n---> world");
    const ann = makeAnnotation({ form: "block", char_start: 6, char_end: 26 });
    const w = new CalloutWidget(ann, false, 6);
    const dom = w.toDOM(view);

    const spy = vi.fn();
    window.addEventListener("lit:open-annotation-builder", spy);
    const header = dom.querySelector(".cm-annotation-callout-header")! as HTMLElement;
    const label = header.querySelector(".cm-annotation-callout-label")! as HTMLElement;
    label.click();
    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.mode).toBe("edit");
    expect(event.detail.annotation).toBe(ann);
    expect(event.detail.originalRange).toEqual({ from: 6, to: 26 });
    window.removeEventListener("lit:open-annotation-builder", spy);
    view.destroy();
  });

  it("fold arrow click does NOT dispatch edit event", () => {
    const view = makeEditorView("hello <!---n\n---\nbody\n---> world");
    const ann = makeAnnotation({ form: "block", char_start: 6, char_end: 26 });
    const w = new CalloutWidget(ann, false, 6);
    const dom = w.toDOM(view);

    const spy = vi.fn();
    window.addEventListener("lit:open-annotation-builder", spy);
    const arrow = dom.querySelector(".cm-annotation-fold-icon")! as HTMLElement;
    arrow.click();
    expect(spy).not.toHaveBeenCalled();
    window.removeEventListener("lit:open-annotation-builder", spy);
    view.destroy();
  });
});

describe("MarkerWidget", () => {
  it("toDOM returns span.cm-annotation-marker-wrap for fireable types", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "llm" }));
    const dom = w.toDOM(view);
    expect(dom.tagName).toBe("SPAN");
    expect(dom.classList.contains("cm-annotation-marker-wrap")).toBe(true);
    const sup = dom.querySelector("sup");
    expect(sup).toBeTruthy();
    expect(sup!.classList.contains("cm-annotation-marker")).toBe(true);
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

  it("mouseleave triggers handleAnnotationLeave with (view)", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation());
    const dom = w.toDOM(view);
    dom.dispatchEvent(new Event("mouseleave"));
    expect(mockHandleLeave).toHaveBeenCalledOnce();
    expect(mockHandleLeave).toHaveBeenCalledWith(view);
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

describe("CalloutWidget mark type", () => {
  beforeEach(() => {
    useMarkConfigStore.setState({ config: { nb: { label: "nota bene", icon: "B" } }, loaded: true });
  });

  afterEach(() => {
    useMarkConfigStore.setState({ config: {}, loaded: false });
  });

  it("renders mark icon from getMarkIcon in the icon span (not the generic diamond)", () => {
    const ann = makeAnnotation({ annotation_type: "mark", mark: "nb", form: "block", body: "body" });
    const w = new CalloutWidget(ann, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const icon = dom.querySelector(".cm-annotation-pill-icon")!;
    expect(icon.textContent).toBe("B");
  });

  it("mark callout icon falls back to code when no config icon", () => {
    useMarkConfigStore.setState({ config: {}, loaded: true });
    const ann = makeAnnotation({ annotation_type: "mark", mark: "sic", form: "block", body: "body" });
    const w = new CalloutWidget(ann, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const icon = dom.querySelector(".cm-annotation-pill-icon")!;
    expect(icon.textContent).toBe("sic");
  });

  it("eq returns false when mark differs", () => {
    const a = new CalloutWidget(makeAnnotation({ annotation_type: "mark", original: "<!---*nb--->", char_start: 0, char_end: 10, mark: "nb" }), false, 0);
    const b = new CalloutWidget(makeAnnotation({ annotation_type: "mark", original: "<!---*nb--->", char_start: 0, char_end: 10, mark: "sic" }), false, 0);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns true when mark matches", () => {
    const a = new CalloutWidget(makeAnnotation({ annotation_type: "mark", original: "<!---*nb--->", char_start: 0, char_end: 10, mark: "nb" }), false, 0);
    const b = new CalloutWidget(makeAnnotation({ annotation_type: "mark", original: "<!---*nb--->", char_start: 0, char_end: 10, mark: "nb" }), false, 0);
    expect(a.eq(b)).toBe(true);
  });
});

describe("fire button", () => {
  describe("PillWidget", () => {
    it("renders .cm-annotation-fire-btn with ▶ for question type", () => {
      const view = makeEditorView();
      const w = new PillWidget(makeAnnotation({ annotation_type: "question", body: "why?" }));
      const dom = w.toDOM(view);
      const btn = dom.querySelector(".cm-annotation-fire-btn");
      expect(btn).toBeTruthy();
      expect(btn!.textContent).toBe("▶");
      view.destroy();
    });

    it("does NOT render fire button for bare type", () => {
      const view = makeEditorView();
      const w = new PillWidget(makeAnnotation({ annotation_type: "bare" }));
      const dom = w.toDOM(view);
      expect(dom.querySelector(".cm-annotation-fire-btn")).toBeNull();
      view.destroy();
    });

    it("fire button mousedown dispatches lit:fire-annotation, NOT lit:open-annotation-builder", () => {
      const view = makeEditorView();
      const ann = makeAnnotation({ annotation_type: "llm", body: "explain" });
      const w = new PillWidget(ann);
      const dom = w.toDOM(view);
      const btn = dom.querySelector(".cm-annotation-fire-btn")! as HTMLElement;

      const fireSpy = vi.fn();
      const editSpy = vi.fn();
      window.addEventListener("lit:fire-annotation", fireSpy);
      window.addEventListener("lit:open-annotation-builder", editSpy);
      btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(fireSpy).toHaveBeenCalledTimes(1);
      const event = fireSpy.mock.calls[0]![0] as CustomEvent;
      expect(event.detail.annotation).toBe(ann);
      expect(editSpy).not.toHaveBeenCalled();
      window.removeEventListener("lit:fire-annotation", fireSpy);
      window.removeEventListener("lit:open-annotation-builder", editSpy);
      view.destroy();
    });

    it("fire button mousedown calls preventDefault and stopPropagation", () => {
      const view = makeEditorView();
      const ann = makeAnnotation({ annotation_type: "llm", body: "explain" });
      const w = new PillWidget(ann);
      const dom = w.toDOM(view);
      const btn = dom.querySelector(".cm-annotation-fire-btn")! as HTMLElement;

      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      const stopSpy = vi.spyOn(event, "stopPropagation");
      btn.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(stopSpy).toHaveBeenCalled();
      view.destroy();
    });

    it("fire button has .cm-annotation-fire-disabled when llmLocked", () => {
      const view = makeEditorView();
      const w = new PillWidget(makeAnnotation({ annotation_type: "llm", body: "test" }), false, true);
      const dom = w.toDOM(view);
      const btn = dom.querySelector(".cm-annotation-fire-btn");
      expect(btn!.classList.contains("cm-annotation-fire-disabled")).toBe(true);
      view.destroy();
    });

    it("does NOT render fire button for note type", () => {
      const view = makeEditorView();
      const w = new PillWidget(makeAnnotation({ annotation_type: "note" }));
      const dom = w.toDOM(view);
      expect(dom.querySelector(".cm-annotation-fire-btn")).toBeNull();
      view.destroy();
    });

    it("does NOT render fire button for todo type", () => {
      const view = makeEditorView();
      const w = new PillWidget(makeAnnotation({ annotation_type: "todo" }));
      const dom = w.toDOM(view);
      expect(dom.querySelector(".cm-annotation-fire-btn")).toBeNull();
      view.destroy();
    });

    it("does NOT render fire button for crossref type", () => {
      const view = makeEditorView();
      const w = new PillWidget(makeAnnotation({ annotation_type: "crossref" }));
      const dom = w.toDOM(view);
      expect(dom.querySelector(".cm-annotation-fire-btn")).toBeNull();
      view.destroy();
    });

    it("does NOT render fire button for apparatus type", () => {
      const view = makeEditorView();
      const w = new PillWidget(makeAnnotation({ annotation_type: "apparatus" }));
      const dom = w.toDOM(view);
      expect(dom.querySelector(".cm-annotation-fire-btn")).toBeNull();
      view.destroy();
    });
  });

  describe("MarkerWidget", () => {
    it("renders .cm-annotation-fire-btn for llm type", () => {
      const view = makeEditorView();
      const w = new MarkerWidget(makeAnnotation({ annotation_type: "llm" }));
      const dom = w.toDOM(view);
      expect(dom.querySelector(".cm-annotation-fire-btn")).toBeTruthy();
      view.destroy();
    });

    it("does NOT render fire button for bare type", () => {
      const view = makeEditorView();
      const w = new MarkerWidget(makeAnnotation({ annotation_type: "bare" }));
      const dom = w.toDOM(view);
      expect(dom.querySelector(".cm-annotation-fire-btn")).toBeNull();
      view.destroy();
    });

    it("does NOT render fire button for note type", () => {
      const view = makeEditorView();
      const w = new MarkerWidget(makeAnnotation({ annotation_type: "note" }));
      const dom = w.toDOM(view);
      expect(dom.querySelector(".cm-annotation-fire-btn")).toBeNull();
      view.destroy();
    });

    it("fire button has .cm-annotation-fire-disabled when llmLocked", () => {
      const view = makeEditorView();
      const w = new MarkerWidget(makeAnnotation({ annotation_type: "llm" }), false, true);
      const dom = w.toDOM(view);
      const btn = dom.querySelector(".cm-annotation-fire-btn");
      expect(btn!.classList.contains("cm-annotation-fire-disabled")).toBe(true);
      view.destroy();
    });
  });

  describe("CalloutWidget", () => {
    it("renders .cm-annotation-fire-btn in header for question type", () => {
      const ann = makeAnnotation({ form: "block", annotation_type: "question", body: "why?" });
      const w = new CalloutWidget(ann, false, 0);
      const dom = w.toDOM(null as unknown as EditorView);
      const btn = dom.querySelector(".cm-annotation-callout-header .cm-annotation-fire-btn");
      expect(btn).toBeTruthy();
      expect(btn!.textContent).toBe("▶");
    });

    it("does NOT render fire button for bare type", () => {
      const ann = makeAnnotation({ form: "block", annotation_type: "bare" });
      const w = new CalloutWidget(ann, false, 0);
      const dom = w.toDOM(null as unknown as EditorView);
      expect(dom.querySelector(".cm-annotation-fire-btn")).toBeNull();
    });

    it("fire button has .cm-annotation-fire-disabled when llmLocked", () => {
      const ann = makeAnnotation({ form: "block", annotation_type: "llm", body: "explain" });
      const w = new CalloutWidget(ann, false, 0, false, true);
      const dom = w.toDOM(null as unknown as EditorView);
      const btn = dom.querySelector(".cm-annotation-fire-btn");
      expect(btn!.classList.contains("cm-annotation-fire-disabled")).toBe(true);
    });
  });
});

describe("firingAnnotationsField", () => {
  it("initial state is an empty Set", () => {
    const state = EditorState.create({ extensions: [firingAnnotationsField] });
    const firing = state.field(firingAnnotationsField);
    expect(firing.size).toBe(0);
  });

  it("setFiringAnnotation adds to the set", () => {
    const state = EditorState.create({ doc: "hello", extensions: [firingAnnotationsField] });
    const tr = state.update({ effects: setFiringAnnotation.of(3) });
    const firing = tr.state.field(firingAnnotationsField);
    expect(firing.has(3)).toBe(true);
  });

  it("clearFiringAnnotation removes from the set", () => {
    const state = EditorState.create({ doc: "hello", extensions: [firingAnnotationsField] });
    const tr1 = state.update({ effects: setFiringAnnotation.of(3) });
    const tr2 = tr1.state.update({ effects: clearFiringAnnotation.of(3) });
    const firing = tr2.state.field(firingAnnotationsField);
    expect(firing.has(3)).toBe(false);
  });

  it("remaps positions on document change", () => {
    const state = EditorState.create({ doc: "hello world", extensions: [firingAnnotationsField] });
    const tr1 = state.update({ effects: setFiringAnnotation.of(6) });
    const tr2 = tr1.state.update({ changes: { from: 0, to: 0, insert: "XX" } });
    const firing = tr2.state.field(firingAnnotationsField);
    expect(firing.has(6)).toBe(false);
    expect(firing.has(8)).toBe(true);
  });
});

describe("spinner rendering", () => {
  it("createFireButton with isFiring=true has cm-annotation-spinner class and a stop icon, not the play glyph", () => {
    const ann = makeAnnotation({ annotation_type: "llm" });
    const btn = createFireButton(ann, true);
    expect(btn).toBeTruthy();
    expect(btn!.classList.contains("cm-annotation-spinner")).toBe(true);
    expect(btn!.querySelector(".cm-annotation-stop-icon")).toBeTruthy();
    expect(btn!.textContent).not.toContain("▶");
  });

  it("createFireButton spinner dispatches lit:cancel-fire on mousedown", () => {
    const ann = makeAnnotation({ annotation_type: "llm" });
    const btn = createFireButton(ann, true);
    expect(btn).toBeTruthy();
    expect(btn!.onmousedown).toBeTruthy();
    const listener = vi.fn();
    window.addEventListener("lit:cancel-fire", listener);
    btn!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("lit:cancel-fire", listener);
  });

  it("createFireButton with isFiring=false has ▶ text", () => {
    const ann = makeAnnotation({ annotation_type: "llm" });
    const btn = createFireButton(ann, false);
    expect(btn).toBeTruthy();
    expect(btn!.textContent).toBe("▶");
    expect(btn!.classList.contains("cm-annotation-spinner")).toBe(false);
  });

  it("PillWidget with isFiring=true renders spinner button", () => {
    const view = makeEditorView();
    const ann = makeAnnotation({ annotation_type: "llm" });
    const w = new PillWidget(ann, true);
    const dom = w.toDOM(view);
    const btn = dom.querySelector(".cm-annotation-fire-btn");
    expect(btn).toBeTruthy();
    expect(btn!.classList.contains("cm-annotation-spinner")).toBe(true);
    view.destroy();
  });

  it("PillWidget eq returns false when isFiring differs", () => {
    const ann = makeAnnotation();
    const a = new PillWidget(ann, false);
    const b = new PillWidget(ann, true);
    expect(a.eq(b)).toBe(false);
  });

  it("MarkerWidget with isFiring=true renders spinner button", () => {
    const view = makeEditorView();
    const ann = makeAnnotation({ annotation_type: "llm" });
    const w = new MarkerWidget(ann, true);
    const dom = w.toDOM(view);
    const btn = dom.querySelector(".cm-annotation-fire-btn");
    expect(btn).toBeTruthy();
    expect(btn!.classList.contains("cm-annotation-spinner")).toBe(true);
    view.destroy();
  });

  it("CalloutWidget with isFiring=true renders spinner button", () => {
    const ann = makeAnnotation({ form: "block", annotation_type: "question", body: "why?" });
    const w = new CalloutWidget(ann, false, 0, true);
    const dom = w.toDOM(null as unknown as EditorView);
    const btn = dom.querySelector(".cm-annotation-fire-btn");
    expect(btn).toBeTruthy();
    expect(btn!.classList.contains("cm-annotation-spinner")).toBe(true);
  });

  it("CalloutWidget eq returns false when isFiring differs", () => {
    const ann = makeAnnotation();
    const a = new CalloutWidget(ann, false, 0, false);
    const b = new CalloutWidget(ann, false, 0, true);
    expect(a.eq(b)).toBe(false);
  });
});

describe("llmLockedField", () => {
  it("initial state is false", () => {
    const state = EditorState.create({ extensions: [llmLockedField] });
    expect(state.field(llmLockedField)).toBe(false);
  });

  it("setLlmLockedEffect.of(true) updates field to true", () => {
    const state = EditorState.create({ extensions: [llmLockedField] });
    const tr = state.update({ effects: setLlmLockedEffect.of(true) });
    expect(tr.state.field(llmLockedField)).toBe(true);
  });

  it("setLlmLockedEffect.of(false) updates field back to false", () => {
    const state = EditorState.create({ extensions: [llmLockedField] });
    const tr1 = state.update({ effects: setLlmLockedEffect.of(true) });
    const tr2 = tr1.state.update({ effects: setLlmLockedEffect.of(false) });
    expect(tr2.state.field(llmLockedField)).toBe(false);
  });
});

describe("createFireButton llmLocked param", () => {
  it("adds disabled class when llmLocked param is true (store is false)", () => {
    useModalLockStore.setState({ llmLocked: false });
    const btn = createFireButton(makeAnnotation({ annotation_type: "llm" }), false, true);
    expect(btn!.classList.contains("cm-annotation-fire-disabled")).toBe(true);
  });

  it("no disabled class when llmLocked param is false (store is true)", () => {
    useModalLockStore.setState({ llmLocked: true });
    const btn = createFireButton(makeAnnotation({ annotation_type: "llm" }), false, false);
    expect(btn!.classList.contains("cm-annotation-fire-disabled")).toBe(false);
  });

  it("does NOT add proximity class when llmLocked is true", () => {
    const btn = createFireButton(makeAnnotation({ annotation_type: "llm" }), false, true);
    expect(btn!.classList.contains("cm-annotation-fire-proximity")).toBe(false);
  });

  it("does NOT dispatch lit:fire-annotation when llmLocked is true", () => {
    const ann = makeAnnotation({ annotation_type: "llm" });
    const btn = createFireButton(ann, false, true)!;
    const spy = vi.fn();
    window.addEventListener("lit:fire-annotation", spy);
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(spy).not.toHaveBeenCalled();
    window.removeEventListener("lit:fire-annotation", spy);
  });
});

describe("widget eq with llmLocked", () => {
  it("PillWidget eq returns false when llmLocked differs", () => {
    const ann = makeAnnotation();
    expect(new PillWidget(ann, false, false).eq(new PillWidget(ann, false, true))).toBe(false);
  });

  it("MarkerWidget eq returns false when llmLocked differs", () => {
    const ann = makeAnnotation();
    expect(new MarkerWidget(ann, false, false).eq(new MarkerWidget(ann, false, true))).toBe(false);
  });

  it("CalloutWidget eq returns false when llmLocked differs", () => {
    const ann = makeAnnotation();
    expect(new CalloutWidget(ann, false, 0, false, false).eq(new CalloutWidget(ann, false, 0, false, true))).toBe(false);
  });
});

describe("fire button proximity reveal", () => {
  it("fire button has cm-annotation-fire-proximity class when not firing", () => {
    const ann = makeAnnotation({ annotation_type: "llm" });
    const btn = createFireButton(ann, false);
    expect(btn).toBeTruthy();
    expect(btn!.classList.contains("cm-annotation-fire-proximity")).toBe(true);
  });

  it("fire button does NOT have cm-annotation-fire-proximity class when isFiring is true", () => {
    const ann = makeAnnotation({ annotation_type: "llm" });
    const btn = createFireButton(ann, true);
    expect(btn).toBeTruthy();
    expect(btn!.classList.contains("cm-annotation-fire-proximity")).toBe(false);
  });

  it("PillWidget fire button has cm-annotation-fire-proximity class", () => {
    const view = makeEditorView();
    const ann = makeAnnotation({ annotation_type: "llm" });
    const w = new PillWidget(ann);
    const dom = w.toDOM(view);
    const btn = dom.querySelector(".cm-annotation-fire-btn");
    expect(btn).toBeTruthy();
    expect(btn!.classList.contains("cm-annotation-fire-proximity")).toBe(true);
    view.destroy();
  });
});

describe("CalloutWidget body markdown rendering", () => {
  it("renders body as HTML via renderMarkdown when expanded", () => {
    const ann = makeAnnotation({
      form: "block",
      body: "**bold** text",
      char_start: 0,
      char_end: 5,
      original: "block",
    });
    const w = new CalloutWidget(ann, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const bodyEl = dom.querySelector(".cm-annotation-callout-body")!;
    expect(bodyEl.innerHTML).toContain("<strong>bold</strong>");
    expect(bodyEl.innerHTML).toContain("text");
  });

  it("sanitizes HTML in body to prevent XSS", () => {
    const ann = makeAnnotation({
      form: "block",
      body: '<script>alert("xss")</script>Safe text',
      char_start: 0,
      char_end: 5,
      original: "block",
    });
    const w = new CalloutWidget(ann, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const bodyEl = dom.querySelector(".cm-annotation-callout-body")!;
    expect(bodyEl.innerHTML).not.toContain("<script>");
    expect(bodyEl.innerHTML).toContain("Safe text");
  });

  it("renders markdown headings in body", () => {
    const ann = makeAnnotation({
      form: "block",
      body: "# Heading\n\nParagraph text",
      char_start: 0,
      char_end: 5,
      original: "block",
    });
    const w = new CalloutWidget(ann, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    const bodyEl = dom.querySelector(".cm-annotation-callout-body")!;
    expect(bodyEl.querySelector("h1")).toBeTruthy();
    expect(bodyEl.querySelector("h1")!.textContent).toBe("Heading");
  });

  it("renders markdown lists in body", () => {
    const ann = makeAnnotation({
      form: "block",
      body: "- item one\n- item two",
      char_start: 0,
      char_end: 5,
      original: "block",
    });
    const w = new CalloutWidget(ann, false, 0);
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

  it("omits the body entirely when collapsed", () => {
    const w = new ThreadWidget(makeThread(), 0, true, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    expect(dom.querySelector(".cm-annotation-callout-body")).toBeNull();
    expect(dom.querySelector(".cm-thread-question")).toBeNull();
    expect(dom.querySelector(".cm-annotation-callout-header")).toBeTruthy();
  });

  it("estimatedHeight is 30 collapsed and greater than 30 expanded", () => {
    const collapsed = new ThreadWidget(makeThread(), 0, true, 0);
    const expanded = new ThreadWidget(makeThread(), 0, false, 0);
    expect(collapsed.estimatedHeight).toBe(30);
    expect(expanded.estimatedHeight).toBeGreaterThan(30);
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

  it("renders a spinner and suppresses the follow-up trigger when isFiring", () => {
    const w = new ThreadWidget(makeThread(), 0, false, 0, true);
    const dom = w.toDOM(null as unknown as EditorView);
    expect(dom.querySelector(".cm-annotation-callout-header .cm-annotation-spinner")).toBeTruthy();
    expect(dom.querySelector(".cm-thread-followup-trigger")).toBeNull();
  });

  it("does NOT render a fire button (threads are not fireable)", () => {
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    const dom = w.toDOM(null as unknown as EditorView);
    expect(dom.querySelector(".cm-annotation-fire-btn")).toBeNull();
  });

  it("follow-up trigger has proximity-reveal class and expands to a textarea on mousedown", () => {
    const view = makeEditorView("x".repeat(50));
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    const dom = w.toDOM(view);
    const trigger = dom.querySelector(".cm-thread-followup-trigger")! as HTMLElement;
    expect(trigger.classList.contains("cm-annotation-fire-proximity")).toBe(true);
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dom.querySelector(".cm-thread-followup-trigger")).toBeNull();
    expect(dom.querySelector(".cm-thread-followup-input")).toBeTruthy();
    view.destroy();
  });

  it("Cmd+Enter in the follow-up textarea dispatches lit:thread-followup with {annotation, question}", () => {
    const view = makeEditorView("x".repeat(50));
    const ann = makeThread();
    const w = new ThreadWidget(ann, 0, false, 0);
    const dom = w.toDOM(view);
    const trigger = dom.querySelector(".cm-thread-followup-trigger")! as HTMLElement;
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const textarea = dom.querySelector(".cm-thread-followup-input")! as HTMLTextAreaElement;
    textarea.value = "What about etymology?";

    const spy = vi.fn();
    window.addEventListener("lit:thread-followup", spy);
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.annotation).toBe(ann);
    expect(event.detail.question).toBe("What about etymology?");
    window.removeEventListener("lit:thread-followup", spy);
    view.destroy();
  });

  it("Escape in the follow-up textarea restores the trigger", () => {
    const view = makeEditorView("x".repeat(50));
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    const dom = w.toDOM(view);
    const trigger = dom.querySelector(".cm-thread-followup-trigger")! as HTMLElement;
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const textarea = dom.querySelector(".cm-thread-followup-input")! as HTMLTextAreaElement;
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(dom.querySelector(".cm-thread-followup-input")).toBeNull();
    expect(dom.querySelector(".cm-thread-followup-trigger")).toBeTruthy();
    view.destroy();
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
    expect(new ThreadWidget(ann, 0, false, 0).eq(new ThreadWidget(ann, 0, false, 0, true))).toBe(false);
    expect(new ThreadWidget(ann, 0, false, 0).eq(new ThreadWidget(ann, 0, false, 0))).toBe(true);
  });

  it("ignoreEvent returns true for mousedown, false for click", () => {
    const w = new ThreadWidget(makeThread(), 0, false, 0);
    expect(w.ignoreEvent(new MouseEvent("mousedown"))).toBe(true);
    expect(w.ignoreEvent(new MouseEvent("click"))).toBe(false);
  });
});

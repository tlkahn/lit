import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { PillWidget, CalloutWidget, MarkerWidget, toggleAnnotationFoldEffect, annotationFoldField } from "./annotationWidgets";
import type { Annotation } from "../../lib/ipc";
import { useModalLockStore } from "../../stores/modalLock";

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
    char_end: 13,
    original: "%%!n | body%%",
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
      original: "%%!n | hello @2026-04%%",
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
    const a = new PillWidget(makeAnnotation({ original: "%%!n%%", char_start: 0, char_end: 6 }));
    const b = new PillWidget(makeAnnotation({ original: "%%!n%%", char_start: 0, char_end: 6, body: "different" }));
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false when different", () => {
    const a = new PillWidget(makeAnnotation({ original: "%%!n%%", char_start: 0, char_end: 6 }));
    const b = new PillWidget(makeAnnotation({ original: "%%!q%%", char_start: 0, char_end: 6 }));
    expect(a.eq(b)).toBe(false);
  });

  it("estimatedHeight returns a value", () => {
    const w = new PillWidget(makeAnnotation());
    expect(w.estimatedHeight).toBeGreaterThan(0);
  });

  it("ignoreEvent returns false", () => {
    const w = new PillWidget(makeAnnotation());
    expect(w.ignoreEvent()).toBe(false);
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
      original: "%%!\nn!\n---\nbody\n%%",
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
});

describe("PillWidget click → edit event", () => {
  it("pill click dispatches lit:open-annotation-builder with edit detail", () => {
    const view = makeEditorView("hello %%!n | test%% world");
    const ann = makeAnnotation({ char_start: 6, char_end: 19, original: "%%!n | test%%" });
    const w = new PillWidget(ann);
    const dom = w.toDOM(view);

    const spy = vi.fn();
    window.addEventListener("lit:open-annotation-builder", spy);
    dom.click();
    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.mode).toBe("edit");
    expect(event.detail.annotation).toBe(ann);
    expect(event.detail.originalRange).toEqual({ from: 6, to: 19 });
    window.removeEventListener("lit:open-annotation-builder", spy);
    view.destroy();
  });
});

describe("CalloutWidget click → edit event", () => {
  it("header click dispatches lit:open-annotation-builder with edit detail", () => {
    const view = makeEditorView("hello %%!n\n---\nbody\n%% world");
    const ann = makeAnnotation({ form: "block", char_start: 6, char_end: 22 });
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
    expect(event.detail.originalRange).toEqual({ from: 6, to: 22 });
    window.removeEventListener("lit:open-annotation-builder", spy);
    view.destroy();
  });

  it("fold arrow click does NOT dispatch edit event", () => {
    const view = makeEditorView("hello %%!n\n---\nbody\n%% world");
    const ann = makeAnnotation({ form: "block", char_start: 6, char_end: 22 });
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
  it("toDOM returns sup.cm-annotation-marker", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation());
    const dom = w.toDOM(view);
    expect(dom.tagName).toBe("SUP");
    expect(dom.classList.contains("cm-annotation-marker")).toBe(true);
    view.destroy();
  });

  it("renders type letter from TYPE_ICON (N for note)", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "note" }));
    const dom = w.toDOM(view);
    expect(dom.textContent).toContain("N");
    view.destroy();
  });

  it("appends ? for tentative certainty", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ certainty: "tentative" }));
    const dom = w.toDOM(view);
    expect(dom.textContent).toContain("?");
    view.destroy();
  });

  it("appends ! for firm certainty", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ certainty: "firm" }));
    const dom = w.toDOM(view);
    expect(dom.textContent).toContain("!");
    view.destroy();
  });

  it("appends nothing for neutral certainty", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "note", certainty: "neutral" }));
    const dom = w.toDOM(view);
    expect(dom.textContent).toContain("N");
    expect(dom.textContent).not.toContain("?");
    expect(dom.textContent).not.toContain("!");
    view.destroy();
  });

  it("sets data-annotation-type attribute", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ annotation_type: "question" }));
    const dom = w.toDOM(view);
    expect(dom.dataset.annotationType).toBe("question");
    view.destroy();
  });

  it("adds cm-annotation-tentative class", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ certainty: "tentative" }));
    const dom = w.toDOM(view);
    expect(dom.classList.contains("cm-annotation-tentative")).toBe(true);
    view.destroy();
  });

  it("adds cm-annotation-firm class", () => {
    const view = makeEditorView();
    const w = new MarkerWidget(makeAnnotation({ certainty: "firm" }));
    const dom = w.toDOM(view);
    expect(dom.classList.contains("cm-annotation-firm")).toBe(true);
    view.destroy();
  });

  it("eq compares original + char_start + char_end", () => {
    const a = new MarkerWidget(makeAnnotation({ original: "%%!n%%", char_start: 0, char_end: 6 }));
    const b = new MarkerWidget(makeAnnotation({ original: "%%!n%%", char_start: 0, char_end: 6, body: "different" }));
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false when different", () => {
    const a = new MarkerWidget(makeAnnotation({ original: "%%!n%%", char_start: 0, char_end: 6 }));
    const b = new MarkerWidget(makeAnnotation({ original: "%%!q%%", char_start: 0, char_end: 6 }));
    expect(a.eq(b)).toBe(false);
  });

  it("ignoreEvent returns false", () => {
    const w = new MarkerWidget(makeAnnotation());
    expect(w.ignoreEvent()).toBe(false);
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

    it("fire button click dispatches lit:fire-annotation, NOT lit:open-annotation-builder", () => {
      const view = makeEditorView();
      const ann = makeAnnotation({ annotation_type: "llm", body: "explain" });
      const w = new PillWidget(ann);
      const dom = w.toDOM(view);
      const btn = dom.querySelector(".cm-annotation-fire-btn")! as HTMLElement;

      const fireSpy = vi.fn();
      const editSpy = vi.fn();
      window.addEventListener("lit:fire-annotation", fireSpy);
      window.addEventListener("lit:open-annotation-builder", editSpy);
      btn.click();
      expect(fireSpy).toHaveBeenCalledTimes(1);
      const event = fireSpy.mock.calls[0]![0] as CustomEvent;
      expect(event.detail.annotation).toBe(ann);
      expect(editSpy).not.toHaveBeenCalled();
      window.removeEventListener("lit:fire-annotation", fireSpy);
      window.removeEventListener("lit:open-annotation-builder", editSpy);
      view.destroy();
    });

    it("fire button has .cm-annotation-fire-disabled when llmLocked", () => {
      useModalLockStore.setState({ llmLocked: true });
      const view = makeEditorView();
      const w = new PillWidget(makeAnnotation({ annotation_type: "note", body: "test" }));
      const dom = w.toDOM(view);
      const btn = dom.querySelector(".cm-annotation-fire-btn");
      expect(btn!.classList.contains("cm-annotation-fire-disabled")).toBe(true);
      view.destroy();
    });
  });

  describe("MarkerWidget", () => {
    it("renders .cm-annotation-fire-btn for note type", () => {
      const view = makeEditorView();
      const w = new MarkerWidget(makeAnnotation({ annotation_type: "note" }));
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

    it("fire button has .cm-annotation-fire-disabled when llmLocked", () => {
      useModalLockStore.setState({ llmLocked: true });
      const view = makeEditorView();
      const w = new MarkerWidget(makeAnnotation({ annotation_type: "todo" }));
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
      useModalLockStore.setState({ llmLocked: true });
      const ann = makeAnnotation({ form: "block", annotation_type: "crossref", body: "cf" });
      const w = new CalloutWidget(ann, false, 0);
      const dom = w.toDOM(null as unknown as EditorView);
      const btn = dom.querySelector(".cm-annotation-fire-btn");
      expect(btn!.classList.contains("cm-annotation-fire-disabled")).toBe(true);
    });
  });
});

import { type EditorView, WidgetType } from "@codemirror/view";
import { StateEffect, StateField, type Transaction } from "@codemirror/state";
import type { Annotation } from "../../lib/ipc";
import { handleAnnotationHover, handleAnnotationLeave } from "./annotationHover";
import { TYPE_ICON, certaintyClass, certaintyMark, truncateBody } from "./annotationConstants";
import "./annotation.css";

export { certaintyClass, certaintyMark };

function buildPillDOM(ann: Annotation): HTMLSpanElement {
  const pill = document.createElement("span");
  pill.className = "cm-annotation-pill";
  const cert = certaintyClass(ann.certainty);
  if (cert) pill.classList.add(cert);
  pill.dataset.annotationType = ann.annotation_type;

  const icon = document.createElement("span");
  icon.className = "cm-annotation-pill-icon";
  icon.textContent = TYPE_ICON[ann.annotation_type] ?? "…";
  pill.appendChild(icon);

  const body = truncateBody(ann.body);
  if (body) {
    const bodyEl = document.createElement("span");
    bodyEl.className = "cm-annotation-pill-body";
    bodyEl.textContent = body;
    pill.appendChild(bodyEl);
  }

  if (ann.date) {
    const date = document.createElement("span");
    date.className = "cm-annotation-date";
    date.textContent = ann.date;
    pill.appendChild(date);
  }

  return pill;
}

export class PillWidget extends WidgetType {
  constructor(readonly annotation: Annotation) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const pill = buildPillDOM(this.annotation);
    pill.onmouseenter = () => handleAnnotationHover(view, this.annotation);
    pill.onmouseleave = () => handleAnnotationLeave(view);
    pill.onclick = (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.annotation.char_start } });
    };
    return pill;
  }

  eq(other: PillWidget): boolean {
    return (
      this.annotation.original === other.annotation.original &&
      this.annotation.char_start === other.annotation.char_start &&
      this.annotation.char_end === other.annotation.char_end
    );
  }

  ignoreEvent(): boolean {
    return false;
  }

  get estimatedHeight(): number {
    return 20;
  }
}

export class MarkerWidget extends WidgetType {
  constructor(readonly annotation: Annotation) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const ann = this.annotation;
    const sup = document.createElement("sup");
    sup.className = "cm-annotation-marker";
    const cert = certaintyClass(ann.certainty);
    if (cert) sup.classList.add(cert);
    sup.dataset.annotationType = ann.annotation_type;
    sup.textContent = (TYPE_ICON[ann.annotation_type] ?? "…") + certaintyMark(ann.certainty);

    sup.onmouseenter = () => handleAnnotationHover(view, ann);
    sup.onmouseleave = () => handleAnnotationLeave(view);
    sup.onclick = (e) => {
      e.preventDefault();
      window.dispatchEvent(
        new CustomEvent("lit:show-annotation", { detail: { charStart: ann.char_start } }),
      );
    };
    return sup;
  }

  eq(other: MarkerWidget): boolean {
    return (
      this.annotation.original === other.annotation.original &&
      this.annotation.char_start === other.annotation.char_start &&
      this.annotation.char_end === other.annotation.char_end
    );
  }

  ignoreEvent(): boolean {
    return false;
  }

  get estimatedHeight(): number {
    return 14;
  }
}

// --- Fold state ---

export const toggleAnnotationFoldEffect = StateEffect.define<{ pos: number }>();

export const annotationFoldField = StateField.define<Map<number, boolean>>({
  create() {
    return new Map();
  },
  update(value: Map<number, boolean>, tr: Transaction) {
    if (!tr.docChanged && !tr.effects.length) return value;
    const newMap = new Map<number, boolean>();
    for (const [pos, collapsed] of value) {
      const newPos = tr.changes.mapPos(pos, 1);
      newMap.set(newPos, collapsed);
    }
    for (const effect of tr.effects) {
      if (effect.is(toggleAnnotationFoldEffect)) {
        const current = newMap.get(effect.value.pos) ?? false;
        newMap.set(effect.value.pos, !current);
      }
    }
    return newMap;
  },
});

// --- Callout Widget ---

function createFoldSvg(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.classList.add("svg-icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "m6 9 6 6 6-6");
  svg.appendChild(path);
  return svg;
}

export class CalloutWidget extends WidgetType {
  constructor(
    readonly annotation: Annotation,
    readonly isCollapsed: boolean,
    readonly pos: number,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const ann = this.annotation;
    const container = document.createElement("div");
    container.className = "cm-annotation-callout";

    const cert = certaintyClass(ann.certainty);
    if (cert) container.classList.add(cert);
    container.dataset.annotationType = ann.annotation_type;

    container.onmouseenter = () => handleAnnotationHover(view, ann);
    container.onmouseleave = () => handleAnnotationLeave(view);

    const header = document.createElement("div");
    header.className = "cm-annotation-callout-header";
    header.onclick = (e) => {
      if ((e.target as HTMLElement).closest(".cm-annotation-fold-icon")) return;
      e.preventDefault();
      view.dispatch({ selection: { anchor: ann.char_start } });
    };

    const icon = document.createElement("span");
    icon.className = "cm-annotation-pill-icon";
    icon.textContent = TYPE_ICON[ann.annotation_type] ?? "…";
    header.appendChild(icon);

    const label = document.createElement("span");
    label.className = "cm-annotation-callout-label";
    label.textContent = ann.annotation_type;
    header.appendChild(label);

    if (ann.date) {
      const date = document.createElement("span");
      date.className = "cm-annotation-date";
      date.textContent = ann.date;
      header.appendChild(date);
    }

    const arrow = document.createElement("span");
    arrow.className = "cm-annotation-fold-icon";
    if (this.isCollapsed) arrow.classList.add("is-collapsed");
    arrow.appendChild(createFoldSvg());
    arrow.onmousedown = (e) => {
      e.preventDefault();
      view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: this.pos }) });
    };
    header.appendChild(arrow);

    container.appendChild(header);

    if (!this.isCollapsed && ann.body) {
      const body = document.createElement("div");
      body.className = "cm-annotation-callout-body";
      body.textContent = ann.body;
      container.appendChild(body);
    }

    return container;
  }

  eq(other: CalloutWidget): boolean {
    return (
      this.annotation.original === other.annotation.original &&
      this.annotation.char_start === other.annotation.char_start &&
      this.annotation.char_end === other.annotation.char_end &&
      this.isCollapsed === other.isCollapsed
    );
  }

  ignoreEvent(event: Event): boolean {
    return event.type === "mousedown";
  }

  get estimatedHeight(): number {
    return this.isCollapsed ? 30 : 80;
  }
}

import { type EditorView, WidgetType } from "@codemirror/view";
import { StateEffect, StateField, type Transaction } from "@codemirror/state";
import { getAnnotationCached, parseAnnotationAsync } from "./annotationCache";
import type { Annotation, AnnotationType } from "../../lib/ipc";
import "./annotation.css";

const TYPE_ICON: Record<AnnotationType, string> = {
  note: "N",
  question: "?",
  todo: "T",
  crossref: "→",
  apparatus: "⊕",
  translation: "译",
  bare: "…",
};

function certaintyClass(certainty: string): string {
  if (certainty === "tentative") return "cm-annotation-tentative";
  if (certainty === "firm") return "cm-annotation-firm";
  return "";
}

function truncateBody(body: string | null, max = 60): string {
  if (!body) return "";
  return body.length > max ? body.slice(0, max) + "…" : body;
}

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
  constructor(
    readonly rawText: string,
    readonly original: string,
    readonly charStart: number,
    readonly charEnd: number,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const cached = getAnnotationCached(this.rawText);
    if (cached && cached.length > 0) {
      const ann = cached.find(
        (a) => a.char_start === this.charStart && a.char_end === this.charEnd,
      ) ?? cached[0]!;
      return buildPillDOM(ann);
    }

    const placeholder = document.createElement("span");
    placeholder.className = "cm-annotation-pill cm-annotation-loading";
    placeholder.textContent = "…";

    parseAnnotationAsync(this.rawText).then((annotations) => {
      if (annotations.length > 0) {
        const ann = annotations.find(
          (a) => a.char_start === this.charStart && a.char_end === this.charEnd,
        ) ?? annotations[0]!;
        const rendered = buildPillDOM(ann);
        placeholder.replaceWith(rendered);
      }
    }).catch(() => {});

    return placeholder;
  }

  eq(other: PillWidget): boolean {
    return this.original === other.original && this.charStart === other.charStart && this.charEnd === other.charEnd;
  }

  ignoreEvent(): boolean {
    return false;
  }

  get estimatedHeight(): number {
    return 20;
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
    readonly rawText: string,
    readonly original: string,
    readonly charStart: number,
    readonly charEnd: number,
    readonly isCollapsed: boolean,
    readonly pos: number,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-annotation-callout";

    const cached = getAnnotationCached(this.rawText);
    const ann = cached?.find(
      (a) => a.char_start === this.charStart && a.char_end === this.charEnd,
    ) ?? cached?.[0];

    const header = document.createElement("div");
    header.className = "cm-annotation-callout-header";

    if (ann) {
      const cert = certaintyClass(ann.certainty);
      if (cert) container.classList.add(cert);
      container.dataset.annotationType = ann.annotation_type;

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
    } else {
      header.textContent = "…";
      parseAnnotationAsync(this.rawText).catch(() => {});
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

    if (!this.isCollapsed && ann?.body) {
      const body = document.createElement("div");
      body.className = "cm-annotation-callout-body";
      body.textContent = ann.body;
      container.appendChild(body);
    }

    return container;
  }

  eq(other: CalloutWidget): boolean {
    return (
      this.original === other.original &&
      this.charStart === other.charStart &&
      this.charEnd === other.charEnd &&
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

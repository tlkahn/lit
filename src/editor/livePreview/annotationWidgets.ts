import { type EditorView, WidgetType } from "@codemirror/view";
import { StateEffect, StateField, type Transaction } from "@codemirror/state";
import type { Annotation } from "../../lib/ipc";
import type { AnnotationBuilderEventDetail } from "../../lib/annotationDsl";
import { canFire } from "../../lib/fireClassification";
import { renderMarkdown, renderInlineMarkdown } from "../../lib/renderMarkdown";
import { handleAnnotationHover, handleAnnotationLeave } from "./annotationHover";
import { TYPE_ICON, getMarkIcon, certaintyClass, certaintyMark, truncateBody } from "./annotationConstants";
import { parseThreadBody } from "../../lib/threadBody";
import "./annotation.css";

export { certaintyClass, certaintyMark };

export interface FireAnnotationEventDetail {
  annotation: Annotation;
}

// --- Firing annotations state (Cycle 11) ---

export const setFiringAnnotation = StateEffect.define<number>();
export const clearFiringAnnotation = StateEffect.define<number>();

export const firingAnnotationsField = StateField.define<Set<number>>({
  create() {
    return new Set();
  },
  update(value, tr) {
    let result = value;
    if (tr.docChanged) {
      result = new Set<number>();
      for (const pos of value) {
        result.add(tr.changes.mapPos(pos, 1));
      }
    }
    for (const effect of tr.effects) {
      if (effect.is(setFiringAnnotation)) {
        if (result === value) result = new Set(value);
        result.add(effect.value);
      } else if (effect.is(clearFiringAnnotation)) {
        if (result === value) result = new Set(value);
        result.delete(effect.value);
      }
    }
    return result;
  },
});

// --- LLM locked state (reactive bridge) ---

export const setLlmLockedEffect = StateEffect.define<boolean>();

export const llmLockedField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setLlmLockedEffect)) return effect.value;
    }
    return value;
  },
});

// --- Fire button ---

export function createFireButton(ann: Annotation, isFiring?: boolean, llmLocked?: boolean): HTMLSpanElement | null {
  if (!canFire(ann.annotation_type)) return null;

  const btn = document.createElement("span");
  btn.className = "cm-annotation-fire-btn";

  if (isFiring) {
    btn.classList.add("cm-annotation-spinner");
    const stop = document.createElement("span");
    stop.className = "cm-annotation-stop-icon";
    stop.textContent = "\u{f04d}"; // nerdfont nf-fa-stop
    btn.appendChild(stop);
    btn.onmousedown = (e) => {
      e.stopPropagation();
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("lit:cancel-fire"));
    };
    return btn;
  }

  if (llmLocked) {
    btn.classList.add("cm-annotation-fire-disabled");
  }

  if (!llmLocked) {
    btn.classList.add("cm-annotation-fire-proximity");
  }

  btn.textContent = "▶";
  btn.onmousedown = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (llmLocked) return;
    window.dispatchEvent(
      new CustomEvent<FireAnnotationEventDetail>("lit:fire-annotation", {
        detail: { annotation: ann },
      }),
    );
  };
  return btn;
}

function dispatchEditEvent(ann: Annotation): void {
  window.dispatchEvent(
    new CustomEvent<AnnotationBuilderEventDetail>("lit:open-annotation-builder", {
      detail: {
        mode: "edit",
        annotation: ann,
        originalRange: { from: ann.char_start, to: ann.char_end },
      },
    }),
  );
}

// Minimal display-only pill for mark annotations: just the mark icon, no body/date.
function buildMinimalMarkPill(ann: Annotation): HTMLSpanElement {
  const pill = document.createElement("span");
  pill.className = "cm-annotation-pill cm-annotation-pill-minimal";
  const cert = certaintyClass(ann.certainty);
  if (cert) pill.classList.add(cert);
  pill.dataset.annotationType = ann.annotation_type;
  pill.dataset.mark = ann.mark ?? "";

  const icon = document.createElement("span");
  icon.className = "cm-annotation-pill-icon";
  icon.textContent = getMarkIcon(ann.mark ?? "");
  pill.appendChild(icon);

  return pill;
}

function buildPillDOM(ann: Annotation): HTMLSpanElement {
  if (ann.annotation_type === "mark") return buildMinimalMarkPill(ann);

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
    bodyEl.innerHTML = renderInlineMarkdown(body);
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
    readonly annotation: Annotation,
    readonly isFiring: boolean = false,
    readonly llmLocked: boolean = false,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const pill = buildPillDOM(this.annotation);
    pill.onmouseenter = (e) => handleAnnotationHover(view, this.annotation, { altKey: e.altKey });
    pill.onmouseleave = () => handleAnnotationLeave(view);
    pill.onclick = (e) => {
      e.preventDefault();
      dispatchEditEvent(this.annotation);
    };
    const fireBtn = createFireButton(this.annotation, this.isFiring, this.llmLocked);
    if (fireBtn) pill.appendChild(fireBtn);
    return pill;
  }

  eq(other: PillWidget): boolean {
    return (
      this.annotation.original === other.annotation.original &&
      this.annotation.char_start === other.annotation.char_start &&
      this.annotation.char_end === other.annotation.char_end &&
      this.annotation.mark === other.annotation.mark &&
      this.isFiring === other.isFiring &&
      this.llmLocked === other.llmLocked
    );
  }

  ignoreEvent(event: Event): boolean {
    return event.type === "mousedown";
  }

  get estimatedHeight(): number {
    return 20;
  }
}

export class MarkerWidget extends WidgetType {
  constructor(
    readonly annotation: Annotation,
    readonly isFiring: boolean = false,
    readonly llmLocked: boolean = false,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const ann = this.annotation;
    const sup = document.createElement("sup");
    sup.className = "cm-annotation-marker";
    const cert = certaintyClass(ann.certainty);
    if (cert) sup.classList.add(cert);
    sup.dataset.annotationType = ann.annotation_type;
    sup.textContent =
      (ann.annotation_type === "mark"
        ? getMarkIcon(ann.mark ?? "")
        : (TYPE_ICON[ann.annotation_type] ?? "…")) + certaintyMark(ann.certainty);

    const fireBtn = createFireButton(ann, this.isFiring, this.llmLocked);
    if (!fireBtn) {
      sup.onmouseenter = (e) => handleAnnotationHover(view, ann, { altKey: e.altKey });
      sup.onmouseleave = () => handleAnnotationLeave(view);
      sup.onclick = (e) => {
        e.preventDefault();
        if (e.metaKey || e.ctrlKey) {
          dispatchEditEvent(ann);
        } else {
          window.dispatchEvent(
            new CustomEvent("lit:show-annotation", { detail: { charStart: ann.char_start } }),
          );
        }
      };
      return sup;
    }

    const wrap = document.createElement("span");
    wrap.className = "cm-annotation-marker-wrap";
    wrap.appendChild(sup);
    if (fireBtn) wrap.appendChild(fireBtn);

    wrap.onmouseenter = (e) => handleAnnotationHover(view, ann, { altKey: e.altKey });
    wrap.onmouseleave = () => handleAnnotationLeave(view);
    wrap.onclick = (e) => {
      if ((e.target as HTMLElement).closest(".cm-annotation-fire-btn")) return;
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        dispatchEditEvent(ann);
      } else {
        window.dispatchEvent(
          new CustomEvent("lit:show-annotation", { detail: { charStart: ann.char_start } }),
        );
      }
    };
    return wrap;
  }

  eq(other: MarkerWidget): boolean {
    return (
      this.annotation.original === other.annotation.original &&
      this.annotation.char_start === other.annotation.char_start &&
      this.annotation.char_end === other.annotation.char_end &&
      this.annotation.mark === other.annotation.mark &&
      this.isFiring === other.isFiring &&
      this.llmLocked === other.llmLocked
    );
  }

  ignoreEvent(event: Event): boolean {
    return event.type === "mousedown";
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

// --- Thread turn state ---

export const setThreadTurnEffect = StateEffect.define<{ pos: number; turn: number }>();

export const threadTurnField = StateField.define<Map<number, number>>({
  create() {
    return new Map();
  },
  update(value: Map<number, number>, tr: Transaction) {
    if (!tr.docChanged && !tr.effects.length) return value;
    const newMap = new Map<number, number>();
    for (const [pos, turn] of value) {
      const newPos = tr.changes.mapPos(pos, 1);
      newMap.set(newPos, turn);
    }
    for (const effect of tr.effects) {
      if (effect.is(setThreadTurnEffect)) {
        newMap.set(effect.value.pos, effect.value.turn);
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
    readonly isFiring: boolean = false,
    readonly llmLocked: boolean = false,
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

    container.onmouseenter = (e) => handleAnnotationHover(view, ann, { altKey: e.altKey });
    container.onmouseleave = () => handleAnnotationLeave(view);

    const header = document.createElement("div");
    header.className = "cm-annotation-callout-header";
    header.onclick = (e) => {
      if ((e.target as HTMLElement).closest(".cm-annotation-fold-icon, .cm-annotation-fire-btn")) return;
      e.preventDefault();
      dispatchEditEvent(ann);
    };

    const icon = document.createElement("span");
    icon.className = "cm-annotation-pill-icon";
    icon.textContent =
      ann.annotation_type === "mark"
        ? getMarkIcon(ann.mark ?? "")
        : (TYPE_ICON[ann.annotation_type] ?? "…");
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

    const fireBtn = createFireButton(ann, this.isFiring, this.llmLocked);
    if (fireBtn) header.appendChild(fireBtn);

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
      body.innerHTML = renderMarkdown(ann.body);
      container.appendChild(body);
    }

    return container;
  }

  eq(other: CalloutWidget): boolean {
    return (
      this.annotation.original === other.annotation.original &&
      this.annotation.char_start === other.annotation.char_start &&
      this.annotation.char_end === other.annotation.char_end &&
      this.annotation.mark === other.annotation.mark &&
      this.isCollapsed === other.isCollapsed &&
      this.isFiring === other.isFiring &&
      this.llmLocked === other.llmLocked
    );
  }

  ignoreEvent(event: Event): boolean {
    return event.type === "mousedown";
  }

  get estimatedHeight(): number {
    return this.isCollapsed ? 30 : 80;
  }
}

// --- Thread Widget ---

export interface ThreadFollowupEventDetail {
  annotation: Annotation;
  question: string;
}

export interface ThreadExportEventDetail {
  annotation: Annotation;
  /** -1 exports the whole thread; otherwise the index of a single turn. */
  turn: number;
}

export interface ThreadDeleteEventDetail {
  annotation: Annotation;
}

export class ThreadWidget extends WidgetType {
  constructor(
    readonly annotation: Annotation,
    readonly turn: number,
    readonly isCollapsed: boolean,
    readonly pos: number,
    readonly isFiring: boolean = false,
    readonly llmLocked: boolean = false,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const ann = this.annotation;
    const turns = parseThreadBody(ann.body ?? "");
    const idx = Math.min(Math.max(this.turn, 0), Math.max(turns.length - 1, 0));

    const container = document.createElement("div");
    container.className = "cm-annotation-callout cm-thread";
    const cert = certaintyClass(ann.certainty);
    if (cert) container.classList.add(cert);
    container.dataset.annotationType = "thread";

    container.onmouseenter = (e) => handleAnnotationHover(view, ann, { altKey: e.altKey });
    container.onmouseleave = () => handleAnnotationLeave(view);

    // --- Header ---
    const header = document.createElement("div");
    header.className = "cm-annotation-callout-header";
    header.onclick = (e) => {
      if (
        (e.target as HTMLElement).closest(
          ".cm-annotation-fold-icon, .cm-thread-nav-arrow, .cm-thread-overflow, .cm-thread-overflow-menu, .cm-annotation-fire-btn",
        )
      )
        return;
      e.preventDefault();
      dispatchEditEvent(ann);
    };

    const icon = document.createElement("span");
    icon.className = "cm-annotation-pill-icon";
    icon.textContent = TYPE_ICON.thread ?? "◇";
    header.appendChild(icon);

    const label = document.createElement("span");
    label.className = "cm-annotation-callout-label";
    label.textContent = "thread";
    header.appendChild(label);

    if (turns.length >= 1) {
      const counter = document.createElement("span");
      counter.className = "cm-thread-turn-counter";
      counter.textContent = `${idx + 1}/${turns.length}`;
      header.appendChild(counter);
    }

    if (turns.length > 1) {
      const nav = document.createElement("span");
      nav.className = "cm-thread-nav";

      const prev = document.createElement("span");
      prev.className = "cm-thread-nav-arrow";
      prev.textContent = "◁";
      prev.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = Math.max(idx - 1, 0);
        view.dispatch({ effects: setThreadTurnEffect.of({ pos: this.pos, turn: next }) });
      };
      nav.appendChild(prev);

      const fwd = document.createElement("span");
      fwd.className = "cm-thread-nav-arrow";
      fwd.textContent = "▷";
      fwd.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = Math.min(idx + 1, turns.length - 1);
        view.dispatch({ effects: setThreadTurnEffect.of({ pos: this.pos, turn: next }) });
      };
      nav.appendChild(fwd);

      header.appendChild(nav);
    }

    if (this.isFiring) {
      const spinner = document.createElement("span");
      spinner.className = "cm-annotation-spinner";
      header.appendChild(spinner);
    }

    // Overflow menu (⋮) — Export thread / Export turn / Delete.
    const overflow = document.createElement("span");
    overflow.className = "cm-thread-overflow";
    overflow.textContent = "⋮";
    const menu = document.createElement("div");
    menu.className = "cm-thread-overflow-menu";

    const addMenuRow = (text: string, handler: () => void) => {
      const row = document.createElement("div");
      row.className = "cm-thread-overflow-row";
      row.textContent = text;
      row.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        overflow.classList.remove("is-open");
        handler();
      };
      menu.appendChild(row);
    };

    addMenuRow("Export thread", () => {
      window.dispatchEvent(
        new CustomEvent<ThreadExportEventDetail>("lit:thread-export", {
          detail: { annotation: ann, turn: -1 },
        }),
      );
    });
    addMenuRow("Export turn", () => {
      window.dispatchEvent(
        new CustomEvent<ThreadExportEventDetail>("lit:thread-export", {
          detail: { annotation: ann, turn: idx },
        }),
      );
    });
    addMenuRow("Delete", () => {
      window.dispatchEvent(
        new CustomEvent<ThreadDeleteEventDetail>("lit:thread-delete", {
          detail: { annotation: ann },
        }),
      );
    });

    overflow.appendChild(menu);
    overflow.onmousedown = (e) => {
      // Only toggle when clicking the ⋮ glyph itself, not a menu row.
      if ((e.target as HTMLElement).closest(".cm-thread-overflow-menu")) return;
      e.preventDefault();
      e.stopPropagation();
      overflow.classList.toggle("is-open");
    };
    header.appendChild(overflow);

    // Fold chevron.
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

    // --- Body ---
    if (!this.isCollapsed) {
      const activeTurn = turns[idx];

      if (activeTurn && activeTurn.question !== "") {
        const question = document.createElement("div");
        question.className = "cm-thread-question";
        // Plain text — never render attacker-controlled markup in the question line.
        question.textContent = activeTurn.question;
        container.appendChild(question);
      }

      const body = document.createElement("div");
      body.className = "cm-annotation-callout-body";
      body.innerHTML = renderMarkdown(activeTurn?.response ?? "");
      container.appendChild(body);

      // Follow-up trigger (proximity-revealed) — suppressed while streaming.
      if (!this.isFiring) {
        const trigger = document.createElement("span");
        trigger.className = "cm-thread-followup-trigger cm-annotation-fire-proximity";
        trigger.textContent = "⊕ Follow up";
        trigger.onmousedown = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const textarea = document.createElement("textarea");
          textarea.className = "cm-thread-followup-input";
          textarea.placeholder = "Ask a follow-up…";
          textarea.onkeydown = (ke) => {
            if (ke.key === "Enter" && (ke.metaKey || ke.ctrlKey)) {
              ke.preventDefault();
              ke.stopPropagation();
              window.dispatchEvent(
                new CustomEvent<ThreadFollowupEventDetail>("lit:thread-followup", {
                  detail: { annotation: ann, question: textarea.value },
                }),
              );
            } else if (ke.key === "Escape") {
              ke.preventDefault();
              ke.stopPropagation();
              textarea.replaceWith(trigger);
            }
          };
          trigger.replaceWith(textarea);
          textarea.focus();
        };
        container.appendChild(trigger);
      }
    }

    return container;
  }

  eq(other: ThreadWidget): boolean {
    return (
      this.annotation.original === other.annotation.original &&
      this.annotation.char_start === other.annotation.char_start &&
      this.annotation.char_end === other.annotation.char_end &&
      this.turn === other.turn &&
      this.isCollapsed === other.isCollapsed &&
      this.isFiring === other.isFiring &&
      this.llmLocked === other.llmLocked
    );
  }

  ignoreEvent(event: Event): boolean {
    return event.type === "mousedown";
  }

  get estimatedHeight(): number {
    return this.isCollapsed ? 30 : 120;
  }
}

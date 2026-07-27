import { type EditorView, WidgetType } from "@codemirror/view";
import { StateEffect, StateField, type Transaction } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { Annotation } from "../../lib/ipc";
import type { AnnotationBuilderEventDetail } from "../../lib/annotationDsl";
import { canFire } from "../../lib/fireClassification";
import { renderMarkdown, renderInlineMarkdown } from "../../lib/renderMarkdown";
import { handleAnnotationHover, handleAnnotationLeave } from "./annotationHover";
import { CLS, TYPE_ICON, getMarkIcon, certaintyClass, certaintyMark, truncateBody } from "./annotationConstants";
import { parseThreadBody } from "../../lib/threadBody";
import "./annotation.css";

export { certaintyClass, certaintyMark };

export interface FireAnnotationEventDetail {
  annotation: Annotation;
}

export interface FocusCardboxCardEventDetail {
  uuid: string;
}

// --- Firing annotations state (Cycle 11) ---

export const setFiringAnnotation = StateEffect.define<number>();
export const clearFiringAnnotation = StateEffect.define<number>();

// --- Firing range state (live-remapping from/to for the active firing annotation) ---

export const setFiringRange = StateEffect.define<{ from: number; to: number }>();
export const clearFiringRange = StateEffect.define<void>();

export const firingRangeField = StateField.define<{ from: number; to: number } | null>({
  create() {
    return null;
  },
  update(value, tr) {
    let result = value;
    if (tr.docChanged && result !== null) {
      result = {
        from: tr.changes.mapPos(result.from, 1),
        to: tr.changes.mapPos(result.to, -1),
      };
    }
    for (const effect of tr.effects) {
      if (effect.is(setFiringRange)) {
        result = effect.value;
      } else if (effect.is(clearFiringRange)) {
        result = null;
      }
    }
    return result;
  },
});

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
  btn.className = CLS.FIRE_BTN;

  if (isFiring) {
    btn.classList.add(CLS.SPINNER);
    const stop = document.createElement("span");
    stop.className = CLS.STOP_ICON;
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
    btn.classList.add(CLS.FIRE_DISABLED);
  }

  if (!llmLocked) {
    btn.classList.add(CLS.FIRE_PROXIMITY);
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

// --- Cardbox link button ---

// Small NerdFont icon shown in expanded annotation headers that switches to
// cardbox view and focuses the matching card. Only rendered once the
// annotation's UUID has been enriched (freshly typed annotations have none).
export function createCardboxLinkButton(ann: Annotation): HTMLSpanElement | null {
  if (!ann.uuid) return null;
  const uuid = ann.uuid;

  const btn = document.createElement("span");
  btn.className = `${CLS.CARDBOX_LINK} ${CLS.FIRE_PROXIMITY}`;
  btn.textContent = "\u{f01bc}"; // nerdfont nf-md-cards (󰆼)
  btn.title = "Show in cardbox";
  btn.onmousedown = (e) => {
    e.stopPropagation();
    e.preventDefault();
    window.dispatchEvent(
      new CustomEvent<FocusCardboxCardEventDetail>("lit:focus-cardbox-card", {
        detail: { uuid },
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
  pill.className = `${CLS.PILL} ${CLS.PILL_MINIMAL}`;
  const cert = certaintyClass(ann.certainty);
  if (cert) pill.classList.add(cert);
  pill.dataset.annotationType = ann.annotation_type;
  pill.dataset.mark = ann.mark ?? "";

  const icon = document.createElement("span");
  icon.className = CLS.PILL_ICON;
  icon.textContent = getMarkIcon(ann.mark ?? "");
  pill.appendChild(icon);

  return pill;
}

function buildPillDOM(ann: Annotation): HTMLSpanElement {
  if (ann.annotation_type === "mark") return buildMinimalMarkPill(ann);

  const pill = document.createElement("span");
  pill.className = CLS.PILL;
  const cert = certaintyClass(ann.certainty);
  if (cert) pill.classList.add(cert);
  pill.dataset.annotationType = ann.annotation_type;

  const icon = document.createElement("span");
  icon.className = CLS.PILL_ICON;
  icon.textContent = TYPE_ICON[ann.annotation_type] ?? "…";
  pill.appendChild(icon);

  const body = truncateBody(ann.body);
  if (body) {
    const bodyEl = document.createElement("span");
    bodyEl.className = CLS.PILL_BODY;
    bodyEl.innerHTML = renderInlineMarkdown(body);
    pill.appendChild(bodyEl);
  }

  if (ann.date) {
    const date = document.createElement("span");
    date.className = CLS.DATE;
    date.textContent = ann.date;
    pill.appendChild(date);
  }

  return pill;
}

// Footnote ref/backref anchors in rendered bodies point at fragment ids.
// Intercept them so clicking scrolls within the widget instead of changing
// location.hash and jumping the editor.
function interceptFootnoteClicks(body: HTMLElement): void {
  body.addEventListener("click", (e) => {
    const anchor =
      e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
    if (!anchor || !body.contains(anchor)) return;
    e.preventDefault();
    const id = anchor.getAttribute("href")!.slice(1);
    const target = body.querySelector(`[id="${CSS.escape(id)}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
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
      if ((e.target as HTMLElement).closest(`.${CLS.CARDBOX_LINK}`)) return;
      e.preventDefault();
      dispatchEditEvent(this.annotation);
    };
    const fireBtn = createFireButton(this.annotation, this.isFiring, this.llmLocked);
    if (fireBtn) pill.appendChild(fireBtn);
    const cardboxLink = createCardboxLinkButton(this.annotation);
    if (cardboxLink) pill.appendChild(cardboxLink);
    return pill;
  }

  eq(other: PillWidget): boolean {
    return (
      this.annotation.original === other.annotation.original &&
      this.annotation.char_start === other.annotation.char_start &&
      this.annotation.char_end === other.annotation.char_end &&
      this.annotation.mark === other.annotation.mark &&
      this.annotation.uuid === other.annotation.uuid &&
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
    sup.className = CLS.MARKER;
    const cert = certaintyClass(ann.certainty);
    if (cert) sup.classList.add(cert);
    sup.dataset.annotationType = ann.annotation_type;
    sup.textContent =
      (ann.annotation_type === "mark"
        ? getMarkIcon(ann.mark ?? "")
        : (TYPE_ICON[ann.annotation_type] ?? "…")) + certaintyMark(ann.certainty);

    const fireBtn = createFireButton(ann, this.isFiring, this.llmLocked);
    const cardboxLink = createCardboxLinkButton(ann);
    if (!fireBtn && !cardboxLink) {
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
    wrap.className = CLS.MARKER_WRAP;
    wrap.appendChild(sup);
    if (fireBtn) wrap.appendChild(fireBtn);
    if (cardboxLink) wrap.appendChild(cardboxLink);

    wrap.onmouseenter = (e) => handleAnnotationHover(view, ann, { altKey: e.altKey });
    wrap.onmouseleave = () => handleAnnotationLeave(view);
    wrap.onclick = (e) => {
      if ((e.target as HTMLElement).closest(`.${CLS.FIRE_BTN}, .${CLS.CARDBOX_LINK}`)) return;
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
      this.annotation.uuid === other.annotation.uuid &&
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

export const setAllAnnotationFoldsEffect = StateEffect.define<{
  positions: number[];
  collapsed: boolean;
}>();

export function isEffectiveFoldAllEffect(e: StateEffect<unknown>): boolean {
  return e.is(setAllAnnotationFoldsEffect) && e.value.positions.length > 0;
}

export const annotationFoldField = StateField.define<Map<number, boolean>>({
  create() {
    return new Map();
  },
  update(value: Map<number, boolean>, tr: Transaction) {
    const hasFoldEffect = tr.effects.some(e => e.is(toggleAnnotationFoldEffect) || isEffectiveFoldAllEffect(e));
    if (!tr.docChanged && !hasFoldEffect) return value;
    const newMap = new Map<number, boolean>();
    for (const [pos, collapsed] of value) {
      const newPos = tr.docChanged ? tr.changes.mapPos(pos, 1) : pos;
      newMap.set(newPos, collapsed);
    }
    for (const effect of tr.effects) {
      if (effect.is(toggleAnnotationFoldEffect)) {
        const current = newMap.get(effect.value.pos) ?? false;
        newMap.set(effect.value.pos, !current);
      }
      if (effect.is(setAllAnnotationFoldsEffect)) {
        for (const pos of effect.value.positions) {
          newMap.set(pos, effect.value.collapsed);
        }
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
    const hasTurnEffect = tr.effects.some(e => e.is(setThreadTurnEffect));
    if (!tr.docChanged && !hasTurnEffect) return value;
    const newMap = new Map<number, number>();
    for (const [pos, turn] of value) {
      const newPos = tr.docChanged ? tr.changes.mapPos(pos, 1) : pos;
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
  svg.classList.add(CLS.SVG_ICON);
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
    container.className = CLS.CALLOUT;

    const cert = certaintyClass(ann.certainty);
    if (cert) container.classList.add(cert);
    container.dataset.annotationType = ann.annotation_type;

    container.onmouseenter = (e) => handleAnnotationHover(view, ann, { altKey: e.altKey });
    container.onmouseleave = () => handleAnnotationLeave(view);

    const header = document.createElement("div");
    header.className = CLS.CALLOUT_HEADER;
    header.onclick = (e) => {
      if ((e.target as HTMLElement).closest(`.${CLS.FOLD_ICON}, .${CLS.FIRE_BTN}, .${CLS.CARDBOX_LINK}`)) return;
      e.preventDefault();
      dispatchEditEvent(ann);
    };

    const icon = document.createElement("span");
    icon.className = CLS.PILL_ICON;
    icon.textContent =
      ann.annotation_type === "mark"
        ? getMarkIcon(ann.mark ?? "")
        : (TYPE_ICON[ann.annotation_type] ?? "…");
    header.appendChild(icon);

    const label = document.createElement("span");
    label.className = CLS.CALLOUT_LABEL;
    label.textContent = ann.annotation_type;
    header.appendChild(label);

    if (ann.date) {
      const date = document.createElement("span");
      date.className = CLS.DATE;
      date.textContent = ann.date;
      header.appendChild(date);
    }

    const fireBtn = createFireButton(ann, this.isFiring, this.llmLocked);
    if (fireBtn) header.appendChild(fireBtn);

    const cardboxLink = createCardboxLinkButton(ann);
    if (cardboxLink) header.appendChild(cardboxLink);

    const arrow = document.createElement("span");
    arrow.className = CLS.FOLD_ICON;
    if (this.isCollapsed) arrow.classList.add(CLS.IS_COLLAPSED);
    arrow.appendChild(createFoldSvg());
    arrow.onmousedown = (e) => {
      e.preventDefault();
      view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: this.pos }) });
    };
    header.appendChild(arrow);

    container.appendChild(header);

    if (!this.isCollapsed && ann.body) {
      const body = document.createElement("div");
      body.className = CLS.CALLOUT_BODY;
      body.innerHTML = renderMarkdown(ann.body);
      interceptFootnoteClicks(body);
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
      this.annotation.uuid === other.annotation.uuid &&
      this.isCollapsed === other.isCollapsed &&
      this.isFiring === other.isFiring &&
      this.llmLocked === other.llmLocked
    );
  }

  updateDOM(dom: HTMLElement, _view: EditorView, from: CalloutWidget): boolean {
    if (
      this.annotation.original !== from.annotation.original ||
      this.annotation.char_start !== from.annotation.char_start ||
      this.annotation.char_end !== from.annotation.char_end ||
      this.annotation.mark !== from.annotation.mark ||
      this.annotation.uuid !== from.annotation.uuid ||
      this.isFiring !== from.isFiring ||
      this.llmLocked !== from.llmLocked
    ) {
      return false;
    }
    if (this.isCollapsed === from.isCollapsed) return true;

    const chevron = dom.querySelector(`.${CLS.FOLD_ICON}`);
    if (!chevron) return false;

    if (this.isCollapsed) {
      const header = dom.querySelector(`.${CLS.CALLOUT_HEADER}`);
      if (!header) return false;
      chevron.classList.add(CLS.IS_COLLAPSED);
      while (dom.lastChild && dom.lastChild !== header) dom.removeChild(dom.lastChild);
    } else {
      chevron.classList.remove(CLS.IS_COLLAPSED);
      if (this.annotation.body) {
        const body = document.createElement("div");
        body.className = CLS.CALLOUT_BODY;
        body.innerHTML = renderMarkdown(this.annotation.body);
        interceptFootnoteClicks(body);
        dom.appendChild(body);
      }
    }
    return true;
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
  /**
   * The thread's LIVE span, re-resolved from the syntaxTree at click time via
   * `view.posAtDOM`. Undefined when it cannot be resolved (no view, DOM not
   * measured, or no enclosing BlockAnnotation node) — the delete then falls
   * back to the annotation's captured char_start/char_end.
   */
  range?: { from: number; to: number };
}

interface OverflowEl extends HTMLElement {
  _litCloseMenu?: () => void;
}

export class ThreadWidget extends WidgetType {
  constructor(
    readonly annotation: Annotation,
    readonly turn: number,
    readonly isCollapsed: boolean,
    readonly pos: number,
    readonly isFiring: boolean = false,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const ann = this.annotation;
    const turns = parseThreadBody(ann.body ?? "");
    const idx = Math.min(Math.max(this.turn, 0), Math.max(turns.length - 1, 0));

    const container = document.createElement("div");
    container.className = `${CLS.CALLOUT} ${CLS.THREAD}`;
    const cert = certaintyClass(ann.certainty);
    if (cert) container.classList.add(cert);
    container.dataset.annotationType = "thread";

    const closeMenu = () => {
      overflow.classList.remove(CLS.IS_OPEN);
      document.removeEventListener("mousedown", onOutsideClick, true);
      document.removeEventListener("keydown", onMenuKeydown, true);
    };

    const onOutsideClick = (e: MouseEvent) => {
      if (!overflow.contains(e.target as Node)) closeMenu();
    };

    const onMenuKeydown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") closeMenu();
    };

    container.onmouseenter = (e) => handleAnnotationHover(view, ann, { altKey: e.altKey });
    container.onmouseleave = () => {
      if (!overflow.classList.contains(CLS.IS_OPEN)) handleAnnotationLeave(view);
    };

    // --- Header ---
    const header = document.createElement("div");
    header.className = CLS.CALLOUT_HEADER;
    header.onclick = (e) => {
      if (
        (e.target as HTMLElement).closest(
          `.${CLS.FOLD_ICON}, .${CLS.THREAD_NAV_ARROW}, .${CLS.THREAD_OVERFLOW}, .${CLS.THREAD_OVERFLOW_MENU}, .${CLS.FIRE_BTN}, .${CLS.CARDBOX_LINK}`,
        )
      )
        return;
      e.preventDefault();
      dispatchEditEvent(ann);
    };

    const icon = document.createElement("span");
    icon.className = CLS.PILL_ICON;
    icon.textContent = TYPE_ICON.thread ?? "◇";
    header.appendChild(icon);

    const label = document.createElement("span");
    label.className = CLS.CALLOUT_LABEL;
    label.textContent = "thread";
    header.appendChild(label);

    if (turns.length >= 1) {
      const counter = document.createElement("span");
      counter.className = CLS.THREAD_TURN_COUNTER;
      counter.textContent = `${idx + 1}/${turns.length}`;
      header.appendChild(counter);
    }

    if (turns.length > 1) {
      const nav = document.createElement("span");
      nav.className = CLS.THREAD_NAV;

      const prev = document.createElement("span");
      prev.className = CLS.THREAD_NAV_ARROW;
      prev.textContent = "◁";
      prev.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = Math.max(idx - 1, 0);
        view.dispatch({ effects: setThreadTurnEffect.of({ pos: this.pos, turn: next }) });
      };
      nav.appendChild(prev);

      const fwd = document.createElement("span");
      fwd.className = CLS.THREAD_NAV_ARROW;
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
      spinner.className = CLS.SPINNER;
      header.appendChild(spinner);
    }

    const cardboxLink = createCardboxLinkButton(ann);
    if (cardboxLink) header.appendChild(cardboxLink);

    // Overflow menu (⋮) — Export thread / Export turn / Delete.
    const overflow = document.createElement("span");
    overflow.className = CLS.THREAD_OVERFLOW;
    overflow.textContent = "⋮";
    const menu = document.createElement("div");
    menu.className = CLS.THREAD_OVERFLOW_MENU;

    const addMenuRow = (text: string, handler: () => void) => {
      const row = document.createElement("div");
      row.className = CLS.THREAD_OVERFLOW_ROW;
      row.textContent = text;
      row.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
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
      // Re-resolve the thread's live span from the syntaxTree at click time so
      // the delete targets the real range even when the captured offsets have
      // gone stale (the annotationDataField only refreshes on a ~150ms debounce).
      let range: { from: number; to: number } | undefined;
      if (view) {
        const pos = view.posAtDOM(container);
        if (pos >= 0) {
          let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null =
            syntaxTree(view.state).resolveInner(pos, 1);
          while (n && n.name !== "BlockAnnotation") n = n.parent;
          if (n) range = { from: n.from, to: n.to };
        }
      }
      window.dispatchEvent(
        new CustomEvent<ThreadDeleteEventDetail>("lit:thread-delete", {
          detail: { annotation: ann, range },
        }),
      );
    });

    overflow.appendChild(menu);
    (overflow as OverflowEl)._litCloseMenu = closeMenu;
    overflow.onmousedown = (e) => {
      if ((e.target as HTMLElement).closest(`.${CLS.THREAD_OVERFLOW_MENU}`)) return;
      e.preventDefault();
      e.stopPropagation();
      if (overflow.classList.contains(CLS.IS_OPEN)) {
        closeMenu();
      } else {
        overflow.classList.add(CLS.IS_OPEN);
        document.addEventListener("mousedown", onOutsideClick, true);
        document.addEventListener("keydown", onMenuKeydown, true);
      }
    };
    header.appendChild(overflow);

    // Fold chevron.
    const arrow = document.createElement("span");
    arrow.className = CLS.FOLD_ICON;
    if (this.isCollapsed) arrow.classList.add(CLS.IS_COLLAPSED);
    arrow.appendChild(createFoldSvg());
    arrow.onmousedown = (e) => {
      e.preventDefault();
      view.dispatch({ effects: toggleAnnotationFoldEffect.of({ pos: this.pos }) });
    };
    header.appendChild(arrow);

    container.appendChild(header);

    if (!this.isCollapsed) {
      this.appendBody(container);
    }

    return container;
  }

  private appendBody(container: HTMLElement): void {
    const ann = this.annotation;
    const turns = parseThreadBody(ann.body ?? "");
    const idx = Math.min(Math.max(this.turn, 0), Math.max(turns.length - 1, 0));
    const activeTurn = turns[idx];

    if (turns.length === 0) {
      const empty = document.createElement("div");
      empty.className = CLS.THREAD_EMPTY;
      empty.textContent = "No conversation yet.";
      container.appendChild(empty);
      return;
    }

    if (activeTurn && activeTurn.question !== "") {
      const question = document.createElement("div");
      question.className = CLS.THREAD_QUESTION;
      // Plain text - never render attacker-controlled markup in the question line.
      question.textContent = activeTurn.question;
      container.appendChild(question);
    }

    const body = document.createElement("div");
    body.className = CLS.CALLOUT_BODY;
    body.innerHTML = renderMarkdown(activeTurn?.response ?? "");
    interceptFootnoteClicks(body);
    container.appendChild(body);

    if (!this.isFiring) {
      const trigger = document.createElement("span");
      trigger.className = `${CLS.THREAD_FOLLOWUP_TRIGGER} ${CLS.FIRE_PROXIMITY}`;
      trigger.textContent = "⊕ Follow up";
      trigger.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const textarea = document.createElement("textarea");
        textarea.className = CLS.THREAD_FOLLOWUP_INPUT;
        textarea.placeholder = "Ask a follow-up…";
        textarea.onpaste = (pe) => {
          pe.stopPropagation();
        };
        textarea.onkeydown = (ke) => {
          ke.stopPropagation();
          if (ke.key === "Enter" && (ke.metaKey || ke.ctrlKey)) {
            ke.preventDefault();
            window.dispatchEvent(
              new CustomEvent<ThreadFollowupEventDetail>("lit:thread-followup", {
                detail: { annotation: ann, question: textarea.value },
              }),
            );
          } else if (ke.key === "Escape") {
            ke.preventDefault();
            textarea.replaceWith(trigger);
          }
        };
        trigger.replaceWith(textarea);
        textarea.focus();
      };
      container.appendChild(trigger);
    }
  }

  eq(other: ThreadWidget): boolean {
    return (
      this.annotation.original === other.annotation.original &&
      this.annotation.char_start === other.annotation.char_start &&
      this.annotation.char_end === other.annotation.char_end &&
      this.annotation.uuid === other.annotation.uuid &&
      this.turn === other.turn &&
      this.isCollapsed === other.isCollapsed &&
      this.isFiring === other.isFiring
    );
  }

  destroy(dom: HTMLElement): void {
    const overflow = dom.querySelector(`.${CLS.THREAD_OVERFLOW}`) as OverflowEl | null;
    overflow?._litCloseMenu?.();
  }

  updateDOM(dom: HTMLElement, _view: EditorView, from: ThreadWidget): boolean {
    if (
      this.annotation.original !== from.annotation.original ||
      this.annotation.char_start !== from.annotation.char_start ||
      this.annotation.char_end !== from.annotation.char_end ||
      this.annotation.uuid !== from.annotation.uuid ||
      this.turn !== from.turn ||
      this.isFiring !== from.isFiring
    ) {
      return false;
    }
    if (this.isCollapsed === from.isCollapsed) return true;

    const chevron = dom.querySelector(`.${CLS.FOLD_ICON}`);
    if (!chevron) return false;

    if (this.isCollapsed) {
      const header = dom.querySelector(`.${CLS.CALLOUT_HEADER}`);
      if (!header) return false;
      const overflow = dom.querySelector(`.${CLS.THREAD_OVERFLOW}`) as OverflowEl | null;
      overflow?._litCloseMenu?.();
      chevron.classList.add(CLS.IS_COLLAPSED);
      while (dom.lastChild && dom.lastChild !== header) dom.removeChild(dom.lastChild);
    } else {
      chevron.classList.remove(CLS.IS_COLLAPSED);
      this.appendBody(dom);
    }
    return true;
  }

  ignoreEvent(event: Event): boolean {
    if (event.type === "mousedown") return true;
    if (event.type === "keydown" || event.type === "paste") {
      const t = event.target;
      return t instanceof HTMLTextAreaElement && t.classList.contains(CLS.THREAD_FOLLOWUP_INPUT);
    }
    return false;
  }

  get estimatedHeight(): number {
    return this.isCollapsed ? 30 : 120;
  }
}

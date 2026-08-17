import { type EditorView, WidgetType } from "@codemirror/view";
import { recordDeparture, highlightLine } from "./crossrefWidgets";
import { isJumpNavigation } from "../jumpHistory";
import { paintFootnoteBody } from "./footnoteTooltip";

/**
 * Shared jump stack for footnote controls (ref -> def and def backref):
 * recordDeparture + dispatch selection + isJumpNavigation + highlightLine +
 * focus. Both FootnoteRefWidget and makeFootnoteBackref own their mousedown
 * fully (preventDefault + stopPropagation).
 */
function jumpToFootnoteTarget(
  view: EditorView,
  event: MouseEvent,
  targetPos: number,
): void {
  event.preventDefault();
  event.stopPropagation();
  const clickPos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? 0;
  recordDeparture(view, clickPos);
  view.dispatch({
    selection: { anchor: targetPos },
    scrollIntoView: true,
    annotations: isJumpNavigation.of(true),
  });
  highlightLine(view, targetPos);
  view.focus();
}

export class FootnoteRefWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly targetDefPos: number | null,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const sup = document.createElement("sup");
    sup.className = "cm-footnote-ref";
    sup.textContent = this.label;

    if (this.targetDefPos != null) {
      const targetPos = this.targetDefPos;
      sup.onmousedown = (e) => {
        jumpToFootnoteTarget(view, e, targetPos);
      };
    }

    return sup;
  }

  eq(other: FootnoteRefWidget): boolean {
    return (
      this.label === other.label &&
      this.targetDefPos === other.targetDefPos
    );
  }

  ignoreEvent(): boolean {
    return true;
  }

  get estimatedHeight(): number {
    return 16;
  }
}

/**
 * Trailing backref control (GitHub-style ↩) on a rendered footnote def that
 * jumps back to the first matching inline [^label] reference. Mirrors
 * FootnoteRefWidget's jump stack: recordDeparture + dispatch selection +
 * isJumpNavigation + highlightLine + focus. Uses span[role=button], not an
 * a[href], so it never trips the body link-mousedown guard or Tauri's
 * external-open handling.
 */
export function makeFootnoteBackref(view: EditorView, targetPos: number): HTMLElement {
  const span = document.createElement("span");
  span.className = "cm-footnote-backref";
  span.setAttribute("role", "button");
  span.setAttribute("tabIndex", "-1");
  span.setAttribute("aria-label", "Jump to reference");
  span.title = "Jump to reference";
  span.textContent = "↩";
  span.onmousedown = (e) => {
    jumpToFootnoteTarget(view, e, targetPos);
  };
  return span;
}

/**
 * Stand-in for a footnote definition's `[^label]:` marker while the caret is
 * outside the definition. Shows the same source label as the superscript
 * refs. When the def has no rendered body widget (empty/whitespace body), it
 * also carries the ↩ backref so empty defs can still round-trip to the ref.
 */
export class FootnoteDefMarkWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly targetRefPos: number | null = null,
  ) {
    super();
  }

  toDOM(view?: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-footnote-def-mark";
    span.textContent = `${this.label}.`;
    if (this.targetRefPos != null && view) {
      span.appendChild(makeFootnoteBackref(view, this.targetRefPos));
    }
    return span;
  }

  eq(other: FootnoteDefMarkWidget): boolean {
    return (
      this.label === other.label &&
      this.targetRefPos === other.targetRefPos
    );
  }

  // Allow caret placement near the marker via normal clicks; do not swallow
  // the event the way the ref superscripts do.
  ignoreEvent(): boolean {
    return false;
  }

  get estimatedHeight(): number {
    return 16;
  }
}

/**
 * Rendered preview of a footnote definition's body while the caret is
 * outside the def (single- and multi-line share this one widget path). The
 * HTML comes from the same `renderFootnoteBody` used by the hover tooltip,
 * so the in-buffer preview and the tooltip cannot drift. Clicking the body
 * is not swallowed: it places the caret into the def so proximity reveals
 * the raw source for in-place editing.
 */
export class FootnoteDefBodyWidget extends WidgetType {
  constructor(
    readonly bodyText: string,
    readonly targetRefPos: number | null = null,
  ) {
    super();
  }

  toDOM(view?: EditorView): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-footnote-def-body";
    paintFootnoteBody(div, this.bodyText);
    // Links inside the rendered body must not navigate (Tauri would open a
    // new window / lose caret placement). preventDefault only, never
    // stopPropagation: CM must still map the click to a doc position inside
    // the replaced range so proximity reveals the raw source.
    div.addEventListener("mousedown", (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("a[href]")) e.preventDefault();
    });
    if (this.targetRefPos != null && view) {
      div.appendChild(makeFootnoteBackref(view, this.targetRefPos));
    }
    return div;
  }

  eq(other: FootnoteDefBodyWidget): boolean {
    return (
      this.bodyText === other.bodyText &&
      this.targetRefPos === other.targetRefPos
    );
  }

  ignoreEvent(): boolean {
    return false;
  }

  // Padding/heights are in CSS; margin is forbidden (CM6 height map).
  get estimatedHeight(): number {
    const lines = Math.max(1, this.bodyText.split("\n").length);
    const displayFences = (this.bodyText.match(/\$\$|\\\[/g) ?? []).length;
    return Math.max(16, lines * 22 + displayFences * 36);
  }
}

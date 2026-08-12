import { type EditorView, WidgetType } from "@codemirror/view";
import { recordDeparture, highlightLine } from "./crossrefWidgets";
import { isJumpNavigation } from "../jumpHistory";
import { renderFootnoteBody } from "./footnoteTooltip";

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
        e.preventDefault();
        e.stopPropagation();
        const clickPos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? 0;
        recordDeparture(view, clickPos);
        view.dispatch({
          selection: { anchor: targetPos },
          scrollIntoView: true,
          annotations: isJumpNavigation.of(true),
        });
        highlightLine(view, targetPos);
        view.focus();
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
 * Stand-in for a footnote definition's `[^label]:` marker in live preview
 * while the caret is outside the definition. Shows the same source label
 * as the superscript refs. Not clickable: defs are the jump target, not the
 * source.
 */
export class FootnoteDefMarkWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-footnote-def-mark";
    span.textContent = `${this.label}.`;
    return span;
  }

  eq(other: FootnoteDefMarkWidget): boolean {
    return this.label === other.label;
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
  constructor(readonly bodyText: string) {
    super();
  }

  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-footnote-def-body";
    div.innerHTML = renderFootnoteBody(this.bodyText);
    return div;
  }

  eq(other: FootnoteDefBodyWidget): boolean {
    return this.bodyText === other.bodyText;
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

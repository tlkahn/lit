import { type EditorView, WidgetType } from "@codemirror/view";
import { recordDeparture, highlightLine } from "./crossrefWidgets";
import { isJumpNavigation } from "../jumpHistory";

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

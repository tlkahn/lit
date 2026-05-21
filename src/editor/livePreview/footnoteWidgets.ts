import { type EditorView, WidgetType } from "@codemirror/view";
import { recordDeparture, highlightLine } from "./crossrefWidgets";
import { isJumpNavigation } from "../jumpHistory";

export class FootnoteRefWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly number: number,
    readonly targetDefPos: number | null,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const sup = document.createElement("sup");
    sup.className = "cm-footnote-ref";
    sup.textContent = String(this.number);

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
      this.number === other.number &&
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

import { type EditorView, WidgetType } from "@codemirror/view";
import { globalJumpTracker } from "../jumpTracker";
import { isJumpNavigation } from "../jumpHistory";
import { useWorkspaceStore } from "../../stores/workspace";

export class CrossrefWidget extends WidgetType {
  constructor(
    readonly original: string,
    readonly renderedText: string,
    readonly isValid: boolean,
    readonly charStart: number,
    readonly charEnd: number,
    readonly targetCharOffset?: number | null,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-crossref-citation";
    if (!this.isValid) span.classList.add("invalid");
    span.textContent = this.renderedText;
    span.setAttribute("title", this.original);
    span.dataset.original = this.original;

    span.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.isValid && this.targetCharOffset != null) {
        recordDeparture(view, this.charStart);
        view.dispatch({
          selection: { anchor: this.targetCharOffset },
          scrollIntoView: true,
          annotations: isJumpNavigation.of(true),
        });
        highlightLine(view, this.targetCharOffset);
      } else {
        view.dispatch({
          selection: { anchor: this.charStart },
        });
      }
      view.focus();
    };

    return span;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    dom.textContent = this.renderedText;
    dom.setAttribute("title", this.original);
    dom.dataset.original = this.original;
    if (this.isValid) {
      dom.classList.remove("invalid");
    } else {
      dom.classList.add("invalid");
    }
    dom.onmousedown = (e) => {
      e!.preventDefault();
      e!.stopPropagation();
      if (this.isValid && this.targetCharOffset != null) {
        recordDeparture(view, this.charStart);
        view.dispatch({
          selection: { anchor: this.targetCharOffset },
          scrollIntoView: true,
          annotations: isJumpNavigation.of(true),
        });
        highlightLine(view, this.targetCharOffset);
      } else {
        view.dispatch({
          selection: { anchor: this.charStart },
        });
      }
      view.focus();
    };
    return true;
  }

  eq(other: CrossrefWidget): boolean {
    return (
      this.original === other.original &&
      this.renderedText === other.renderedText &&
      this.isValid === other.isValid &&
      this.charStart === other.charStart &&
      this.charEnd === other.charEnd &&
      this.targetCharOffset === other.targetCharOffset
    );
  }

  ignoreEvent(): boolean {
    return true;
  }

  get estimatedHeight(): number {
    return 20;
  }
}

export class DefinitionWidget extends WidgetType {
  constructor(
    readonly original: string,
    readonly renderedText: string,
    readonly isValid: boolean,
    readonly charStart: number,
    readonly charEnd: number,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-crossref-definition";
    span.textContent = this.renderedText;
    span.dataset.original = this.original;

    span.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.charStart },
      });
      view.focus();
    };

    return span;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    dom.textContent = this.renderedText;
    dom.dataset.original = this.original;
    dom.onmousedown = (e) => {
      e!.preventDefault();
      e!.stopPropagation();
      view.dispatch({
        selection: { anchor: this.charStart },
      });
      view.focus();
    };
    return true;
  }

  eq(other: DefinitionWidget): boolean {
    return (
      this.original === other.original &&
      this.renderedText === other.renderedText &&
      this.isValid === other.isValid &&
      this.charStart === other.charStart &&
      this.charEnd === other.charEnd
    );
  }

  ignoreEvent(): boolean {
    return true;
  }

  get estimatedHeight(): number {
    return 20;
  }
}

function recordDeparture(view: EditorView, departurePos: number): void {
  const notePath = useWorkspaceStore.getState().currentPagePath ?? "";
  const line = view.state.doc.lineAt(departurePos);
  globalJumpTracker.recordJump(
    { notePath, line: line.number, col: departurePos - line.from },
    { notePath: "", line: 0, col: 0 },
  );
}

export function highlightLine(view: EditorView, pos: number): void {
  const line = view.state.doc.lineAt(pos);
  const lineEl = view.domAtPos(line.from)?.node?.parentElement;
  if (!lineEl) return;
  const cmLine = lineEl.closest(".cm-line") ?? lineEl;
  cmLine.classList.add("cm-crossref-highlight-blink");
  setTimeout(() => {
    cmLine.classList.remove("cm-crossref-highlight-blink");
  }, 1500);
}

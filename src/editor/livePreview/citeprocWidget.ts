import { type EditorView, WidgetType } from "@codemirror/view";
import { openBibFile } from "../../lib/ipc";

export class CiteprocWidget extends WidgetType {
  constructor(
    readonly original: string,
    readonly renderedText: string,
    readonly isValid: boolean,
    readonly charStart: number,
    readonly charEnd: number,
    readonly bibFile?: string,
    readonly lineNumber?: number,
    readonly commandTemplate: string = "open {file}",
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-crossref-citeproc";
    if (!this.isValid) span.classList.add("invalid");
    span.textContent = this.renderedText;
    span.setAttribute("title", this.original);
    span.dataset.original = this.original;

    span.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.isValid && this.bibFile != null && this.lineNumber != null) {
        openBibFile(this.bibFile, this.lineNumber, this.commandTemplate).catch(() => {});
      } else {
        view.dispatch({
          selection: { anchor: this.charStart },
        });
      }
      view.focus();
    });

    return span;
  }

  eq(other: CiteprocWidget): boolean {
    return (
      this.original === other.original &&
      this.renderedText === other.renderedText &&
      this.isValid === other.isValid &&
      this.charStart === other.charStart &&
      this.charEnd === other.charEnd &&
      this.bibFile === other.bibFile &&
      this.lineNumber === other.lineNumber &&
      this.commandTemplate === other.commandTemplate
    );
  }

  ignoreEvent(): boolean {
    return true;
  }

  get estimatedHeight(): number {
    return 20;
  }
}

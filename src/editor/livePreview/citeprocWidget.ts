import { type EditorView, WidgetType } from "@codemirror/view";
import { useWorkspaceStore } from "../../stores/workspace";

export class CiteprocWidget extends WidgetType {
  constructor(
    readonly original: string,
    readonly renderedText: string,
    readonly isValid: boolean,
    readonly charStart: number,
    readonly charEnd: number,
    readonly bibFile?: string,
    readonly lineNumber?: number,
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

    span.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.isValid && this.bibFile != null && this.lineNumber != null) {
        const { workspacePath, selectPageAtLine } = useWorkspaceStore.getState();
        if (workspacePath && this.bibFile.startsWith(workspacePath + "/")) {
          const relativePath = this.bibFile.slice(workspacePath.length + 1);
          selectPageAtLine(relativePath, this.lineNumber);
          return;
        }
      }
      view.dispatch({
        selection: { anchor: this.charStart },
      });
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
      if (this.isValid && this.bibFile != null && this.lineNumber != null) {
        const { workspacePath, selectPageAtLine } = useWorkspaceStore.getState();
        if (workspacePath && this.bibFile.startsWith(workspacePath + "/")) {
          const relativePath = this.bibFile.slice(workspacePath.length + 1);
          selectPageAtLine(relativePath, this.lineNumber);
          return;
        }
      }
      view.dispatch({
        selection: { anchor: this.charStart },
      });
      view.focus();
    };
    return true;
  }

  eq(other: CiteprocWidget): boolean {
    return (
      this.original === other.original &&
      this.renderedText === other.renderedText &&
      this.isValid === other.isValid &&
      this.charStart === other.charStart &&
      this.charEnd === other.charEnd &&
      this.bibFile === other.bibFile &&
      this.lineNumber === other.lineNumber
    );
  }

  ignoreEvent(): boolean {
    return true;
  }

  get estimatedHeight(): number {
    return 20;
  }
}

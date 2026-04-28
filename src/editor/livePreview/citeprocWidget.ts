import { type EditorView, WidgetType } from "@codemirror/view";
import { useWorkspaceStore } from "../../stores/workspace";
import { globalJumpTracker } from "../jumpTracker";

export interface CiteprocLinkInfo {
  renderedText: string;
  bibFile?: string;
  lineNumber?: number;
  isValid: boolean;
}

export class CiteprocWidget extends WidgetType {
  constructor(
    readonly original: string,
    readonly links: CiteprocLinkInfo[],
    readonly charStart: number,
    readonly charEnd: number,
  ) {
    super();
  }

  get isValid(): boolean {
    return this.links.every((l) => l.isValid);
  }

  get renderedText(): string {
    return this.links.map((l) => l.renderedText).join("; ");
  }

  private buildChildren(parent: HTMLElement, view: EditorView): void {
    parent.textContent = "";
    for (let i = 0; i < this.links.length; i++) {
      if (i > 0) {
        parent.appendChild(document.createTextNode("; "));
      }
      const link = this.links[i]!;
      const keySpan = document.createElement("span");
      keySpan.className = "cm-crossref-citeproc-key";
      if (!link.isValid) keySpan.classList.add("invalid");
      keySpan.textContent = link.renderedText;
      keySpan.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (link.isValid && link.bibFile != null && link.lineNumber != null) {
          const { workspacePath, selectPageAtLine, currentPagePath } =
            useWorkspaceStore.getState();
          if (workspacePath && link.bibFile.startsWith(workspacePath + "/")) {
            const relativePath = link.bibFile.slice(workspacePath.length + 1);
            const clickPos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? this.charStart;
            recordCiteprocDeparture(view, currentPagePath, clickPos);
            globalJumpTracker.isNavigating = true;
            selectPageAtLine(relativePath, link.lineNumber);
            return;
          }
        }
        view.dispatch({
          selection: { anchor: this.charStart },
        });
        view.focus();
      };
      parent.appendChild(keySpan);
    }
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-crossref-citeproc";
    if (!this.isValid) span.classList.add("invalid");
    span.setAttribute("title", this.original);
    span.dataset.original = this.original;
    this.buildChildren(span, view);
    return span;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    dom.setAttribute("title", this.original);
    dom.dataset.original = this.original;
    if (this.isValid) {
      dom.classList.remove("invalid");
    } else {
      dom.classList.add("invalid");
    }
    this.buildChildren(dom, view);
    return true;
  }

  eq(other: CiteprocWidget): boolean {
    return (
      this.original === other.original &&
      this.charStart === other.charStart &&
      this.charEnd === other.charEnd &&
      this.links.length === other.links.length &&
      this.links.every((l, i) => {
        const o = other.links[i]!;
        return (
          l.renderedText === o.renderedText &&
          l.bibFile === o.bibFile &&
          l.lineNumber === o.lineNumber &&
          l.isValid === o.isValid
        );
      })
    );
  }

  ignoreEvent(): boolean {
    return true;
  }

  get estimatedHeight(): number {
    return 20;
  }
}

export function recordCiteprocDeparture(
  view: EditorView,
  currentPagePath: string | null,
  departurePos: number,
): void {
  const notePath = currentPagePath ?? "";
  const line = view.state.doc.lineAt(departurePos);
  globalJumpTracker.recordJump(
    { notePath, line: line.number, col: departurePos - line.from },
    { notePath: "", line: 0, col: 0 },
  );
}

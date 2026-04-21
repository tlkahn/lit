import { type EditorView, WidgetType } from "@codemirror/view";
import { getCalloutIcon, toggleCalloutEffect } from "./callout";
import katex from "katex";
import "katex/dist/katex.min.css";

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "300px";
    img.style.display = "block";
    return img;
  }

  eq(other: ImageWidget): boolean {
    return this.src === other.src && this.alt === other.alt;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export class CalloutHeaderWidget extends WidgetType {
  constructor(
    readonly calloutType: string,
    readonly title: string,
    readonly isCollapsed: boolean,
    readonly pos: number,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const header = document.createElement("div");
    header.className = "cm-callout-header";

    const arrow = document.createElement("span");
    arrow.className = "cm-callout-fold-icon";
    arrow.textContent = this.isCollapsed ? "▸" : "▾";
    arrow.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ effects: toggleCalloutEffect.of({ pos: this.pos }) });
    });

    const icon = document.createElement("span");
    icon.className = "cm-callout-icon";
    icon.textContent = getCalloutIcon(this.calloutType);

    const title = document.createElement("span");
    title.className = "cm-callout-title";
    title.textContent = this.title;

    header.appendChild(arrow);
    header.appendChild(icon);
    header.appendChild(title);
    return header;
  }

  eq(other: CalloutHeaderWidget): boolean {
    return (
      this.calloutType === other.calloutType &&
      this.title === other.title &&
      this.isCollapsed === other.isCollapsed
    );
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export class InlineMathWidget extends WidgetType {
  constructor(readonly latex: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-preview-math-inline";
    try {
      katex.render(this.latex, span, { throwOnError: false, displayMode: false });
    } catch {
      span.textContent = this.latex;
      span.classList.add("cm-preview-math-error");
    }
    return span;
  }

  eq(other: InlineMathWidget): boolean {
    return this.latex === other.latex;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export class DisplayMathWidget extends WidgetType {
  constructor(readonly latex: string) {
    super();
  }

  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-preview-math-display";
    try {
      katex.render(this.latex, div, { throwOnError: false, displayMode: true });
    } catch {
      div.textContent = this.latex;
      div.classList.add("cm-preview-math-error");
    }
    return div;
  }

  eq(other: DisplayMathWidget): boolean {
    return this.latex === other.latex;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

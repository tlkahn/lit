import { type EditorView, WidgetType } from "@codemirror/view";
import { getCalloutIcon, toggleCalloutEffect } from "./callout";
import { getCellPosition, parseTable, renderInlineMarkdown, type Alignment } from "./table";
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
    readonly foldable: boolean,
    readonly pos: number,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const header = document.createElement("div");
    header.className = "cm-callout-header";

    if (this.foldable) {
      const arrow = document.createElement("span");
      arrow.className = "cm-callout-fold-icon";
      arrow.textContent = this.isCollapsed ? "▸" : "▾";
      arrow.addEventListener("mousedown", (e) => {
        e.preventDefault();
        view.dispatch({ effects: toggleCalloutEffect.of({ pos: this.pos }) });
      });
      header.appendChild(arrow);
    }

    const icon = document.createElement("span");
    icon.className = "cm-callout-icon";
    icon.textContent = getCalloutIcon(this.calloutType);

    const title = document.createElement("span");
    title.className = "cm-callout-title";
    title.textContent = this.title;

    header.appendChild(icon);
    header.appendChild(title);
    return header;
  }

  eq(other: CalloutHeaderWidget): boolean {
    return (
      this.calloutType === other.calloutType &&
      this.title === other.title &&
      this.isCollapsed === other.isCollapsed &&
      this.foldable === other.foldable &&
      this.pos === other.pos
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

export class TableWidget extends WidgetType {
  constructor(
    readonly tableText: string,
    readonly from: number,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-preview-table-container";

    const parsed = parseTable(this.tableText);
    if (!parsed) return container;

    const table = document.createElement("table");
    table.className = "cm-preview-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    parsed.headers.forEach((header, i) => {
      const th = document.createElement("th");
      th.innerHTML = renderInlineMarkdown(header);
      th.dataset.row = "0";
      th.dataset.col = String(i);
      applyAlignment(th, parsed.alignments[i]);
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    if (parsed.rows.length > 0) {
      const tbody = document.createElement("tbody");
      let rowIndex = 1;
      for (const row of parsed.rows) {
        const tr = document.createElement("tr");
        row.forEach((cell, i) => {
          const td = document.createElement("td");
          td.innerHTML = renderInlineMarkdown(cell);
          td.dataset.row = String(rowIndex);
          td.dataset.col = String(i);
          applyAlignment(td, parsed.alignments[i]);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
        rowIndex++;
      }
      table.appendChild(tbody);
    }

    container.addEventListener("mousedown", (e) => {
      const cell = (e.target as HTMLElement).closest("th, td") as HTMLElement | null;
      if (!cell) return;
      e.preventDefault();
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const pos = getCellPosition(this.tableText, this.from, row, col);
      view.dispatch({ selection: { anchor: pos } });
    });

    container.appendChild(table);
    return container;
  }

  eq(other: TableWidget): boolean {
    return this.tableText === other.tableText && this.from === other.from;
  }

  ignoreEvent(event: Event): boolean {
    return event.type === "mousedown";
  }
}

function applyAlignment(el: HTMLElement, alignment: Alignment | undefined) {
  if (alignment && alignment !== "default") {
    el.style.textAlign = alignment;
  }
}

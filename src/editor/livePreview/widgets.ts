import { type EditorView, WidgetType } from "@codemirror/view";
import { getCalloutIcon, toggleCalloutEffect } from "./callout";
import { parseTable, renderInlineMarkdown, serializeTable, type Alignment, type ParsedTable } from "./table";
import { renderMermaid, getMermaidCached } from "./mermaid";
import katex from "katex";
import "katex/dist/katex.min.css";

const SPINNER_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><style>.spinner{transform-origin:center;animation:rotate .75s linear infinite}@keyframes rotate{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style><g class="spinner"><circle cx="12" cy="2.5" r="1.5" opacity=".14"/><circle cx="16.75" cy="3.77" r="1.5" opacity=".29"/><circle cx="20.23" cy="7.25" r="1.5" opacity=".43"/><circle cx="21.5" cy="12" r="1.5" opacity=".57"/><circle cx="20.23" cy="16.75" r="1.5" opacity=".71"/><circle cx="16.75" cy="20.23" r="1.5" opacity=".86"/><circle cx="12" cy="21.5" r="1.5"/></g></svg>`;

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

    const icon = document.createElement("span");
    icon.className = "cm-callout-icon";
    icon.textContent = getCalloutIcon(this.calloutType);

    const title = document.createElement("span");
    title.className = "cm-callout-title";
    title.textContent = this.title;

    header.appendChild(icon);
    header.appendChild(title);

    if (this.foldable) {
      const arrow = document.createElement("span");
      arrow.className = "cm-callout-fold-icon";
      if (this.isCollapsed) arrow.classList.add("is-collapsed");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "24");
      svg.setAttribute("height", "24");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.classList.add("svg-icon");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "m6 9 6 6 6-6");
      svg.appendChild(path);
      arrow.appendChild(svg);
      arrow.addEventListener("mousedown", (e) => {
        e.preventDefault();
        view.dispatch({ effects: toggleCalloutEffect.of({ pos: this.pos }) });
      });
      header.appendChild(arrow);
    }
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

  get estimatedHeight(): number {
    return 30;
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

export class EditableTableWidget extends WidgetType {
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

    const commitCell = (row: number, col: number, nextValue: string) => {
      const updated: ParsedTable = {
        headers: [...parsed.headers],
        alignments: [...parsed.alignments],
        rows: parsed.rows.map((r) => [...r]),
      };
      if (row === 0) {
        updated.headers[col] = nextValue;
      } else {
        updated.rows[row - 1]![col] = nextValue;
      }
      const newMarkdown = serializeTable(updated);
      view.dispatch({
        changes: { from: this.from, to: this.from + this.tableText.length, insert: newMarkdown },
      });
    };

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    parsed.headers.forEach((header, i) => {
      const th = createEditableCell("th", header, parsed.alignments[i], (next) => commitCell(0, i, next));
      th.dataset.row = "0";
      th.dataset.col = String(i);
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    if (parsed.rows.length > 0) {
      const tbody = document.createElement("tbody");
      parsed.rows.forEach((row, ri) => {
        const rowIndex = ri + 1;
        const tr = document.createElement("tr");
        row.forEach((cell, i) => {
          const td = createEditableCell("td", cell, parsed.alignments[i], (next) => commitCell(rowIndex, i, next));
          td.dataset.row = String(rowIndex);
          td.dataset.col = String(i);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
    }

    container.appendChild(table);
    return container;
  }

  eq(other: EditableTableWidget): boolean {
    return this.tableText === other.tableText && this.from === other.from;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function createEditableCell(
  tag: "th" | "td",
  value: string,
  alignment: Alignment | undefined,
  onCommit: (next: string) => void,
): HTMLTableCellElement {
  const cell = document.createElement(tag);
  cell.innerHTML = renderInlineMarkdown(value);
  cell.dataset.raw = value;
  cell.setAttribute("contenteditable", "true");
  cell.spellcheck = false;
  applyAlignment(cell, alignment);

  let selectAllOnFocus = false;

  cell.addEventListener("mousedown", () => {
    selectAllOnFocus = cell.childElementCount > 0;
  });

  cell.addEventListener("focus", () => {
    const raw = cell.dataset.raw ?? "";
    cell.textContent = raw;
    const sel = window.getSelection();
    if (sel && cell.firstChild) {
      const range = document.createRange();
      if (selectAllOnFocus) {
        range.selectNodeContents(cell);
        selectAllOnFocus = false;
      } else {
        range.selectNodeContents(cell);
        range.collapse(false);
      }
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });

  cell.addEventListener("blur", () => {
    const next = cell.textContent ?? "";
    const raw = cell.dataset.raw ?? "";
    if (next !== raw) {
      cell.dataset.raw = next;
      onCommit(next);
    }
    cell.innerHTML = renderInlineMarkdown(cell.dataset.raw ?? "");
  });

  cell.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const next = cell.textContent ?? "";
      const raw = cell.dataset.raw ?? "";
      if (next !== raw) {
        cell.dataset.raw = next;
        onCommit(next);
      }
      cell.blur();
    }
  });

  return cell;
}

export class MermaidWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly theme: "default" | "dark",
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-preview-mermaid";

    const cached = getMermaidCached(this.source, this.theme);
    if (cached) {
      container.innerHTML = cached;
      return container;
    }

    const loading = document.createElement("div");
    loading.className = "cm-preview-mermaid-loading";
    loading.innerHTML = SPINNER_SVG;
    container.appendChild(loading);

    renderMermaid(this.source, this.theme)
      .then((svg) => {
        if (!container.isConnected) return;
        container.innerHTML = svg;
      })
      .catch((err) => {
        if (!container.isConnected) return;
        container.innerHTML = "";
        const error = document.createElement("div");
        error.className = "cm-preview-mermaid-error";
        error.textContent = err instanceof Error ? err.message : String(err);
        container.appendChild(error);
      });

    return container;
  }

  eq(other: MermaidWidget): boolean {
    return this.source === other.source && this.theme === other.theme;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function applyAlignment(el: HTMLElement, alignment: Alignment | undefined) {
  if (alignment && alignment !== "default") {
    el.style.textAlign = alignment;
  }
}

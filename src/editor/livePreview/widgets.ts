import { type EditorView, WidgetType } from "@codemirror/view";
import { getCalloutIcon, toggleCalloutEffect } from "./callout";
import { parseTable, renderInlineMarkdown, serializeTable, type Alignment, type ParsedTable } from "./table";
import { renderMermaid, getMermaidCached } from "./mermaid";
import { showMediaLightbox } from "./lightbox";
import { navigateToPageFacet } from "./navigateToPageFacet";
import { getKatexSync, loadKatex } from "./katexLoader";
import "katex/dist/katex.min.css";

const SPINNER_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><style>.spinner{transform-origin:center;animation:rotate .75s linear infinite}@keyframes rotate{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style><g class="spinner"><circle cx="12" cy="2.5" r="1.5" opacity=".14"/><circle cx="16.75" cy="3.77" r="1.5" opacity=".29"/><circle cx="20.23" cy="7.25" r="1.5" opacity=".43"/><circle cx="21.5" cy="12" r="1.5" opacity=".57"/><circle cx="20.23" cy="16.75" r="1.5" opacity=".71"/><circle cx="16.75" cy="20.23" r="1.5" opacity=".86"/><circle cx="12" cy="21.5" r="1.5"/></g></svg>`;

const failedImageSrcs = new Set<string>();

export function clearFailedImageCache(): void {
  failedImageSrcs.clear();
}

function attachImageHandlers(img: HTMLImageElement, src: string): void {
  img.addEventListener("error", () => {
    failedImageSrcs.add(src);
    img.classList.add("cm-preview-image-error");
  }, { once: true });
  img.addEventListener("load", () => {
    failedImageSrcs.delete(src);
  }, { once: true });
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly thumbnail: boolean = false,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    if (this.thumbnail) {
      const container = document.createElement("div");
      container.className = "cm-preview-image-thumbnail";
      const img = document.createElement("img");
      img.alt = this.alt;
      if (failedImageSrcs.has(this.src)) {
        img.classList.add("cm-preview-image-error");
      } else {
        img.src = this.src;
        attachImageHandlers(img, this.src);
      }
      container.appendChild(img);
      container.addEventListener("mousedown", (e) => {
        e.preventDefault();
        showMediaLightbox({ type: "image", src: this.src });
      });
      return container;
    }
    const img = document.createElement("img");
    img.className = "cm-preview-image";
    img.alt = this.alt;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "300px";
    img.style.display = "block";
    if (failedImageSrcs.has(this.src)) {
      img.classList.add("cm-preview-image-error");
    } else {
      img.src = this.src;
      attachImageHandlers(img, this.src);
    }
    return img;
  }

  updateDOM(dom: HTMLElement): boolean {
    if (this.thumbnail) {
      const img = dom.querySelector("img");
      if (!img) return false;
      img.alt = this.alt;
      if (failedImageSrcs.has(this.src)) {
        img.removeAttribute("src");
        img.classList.add("cm-preview-image-error");
      } else {
        img.classList.remove("cm-preview-image-error");
        img.src = this.src;
        attachImageHandlers(img, this.src);
      }
      return true;
    }
    const img = dom as HTMLImageElement;
    img.alt = this.alt;
    if (failedImageSrcs.has(this.src)) {
      img.removeAttribute("src");
      img.classList.add("cm-preview-image-error");
    } else {
      img.classList.remove("cm-preview-image-error");
      img.src = this.src;
      attachImageHandlers(img, this.src);
    }
    return true;
  }

  eq(other: ImageWidget): boolean {
    return this.src === other.src && this.alt === other.alt && this.thumbnail === other.thumbnail;
  }

  ignoreEvent(event: Event): boolean {
    return this.thumbnail ? event.type === "mousedown" : false;
  }

  get estimatedHeight(): number {
    return this.thumbnail ? 128 : 200;
  }
}

function createFoldSvg(): SVGSVGElement {
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
  return svg;
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
      arrow.appendChild(createFoldSvg());
      arrow.onmousedown = (e) => {
        e.preventDefault();
        view.dispatch({ effects: toggleCalloutEffect.of({ pos: this.pos }) });
      };
      header.appendChild(arrow);
    }
    return header;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const icon = dom.querySelector(".cm-callout-icon") as HTMLElement;
    if (icon) icon.textContent = getCalloutIcon(this.calloutType);

    const title = dom.querySelector(".cm-callout-title") as HTMLElement;
    if (title) title.textContent = this.title;

    let arrow = dom.querySelector(".cm-callout-fold-icon") as HTMLElement | null;
    if (this.foldable) {
      if (!arrow) {
        arrow = document.createElement("span");
        arrow.className = "cm-callout-fold-icon";
        arrow.appendChild(createFoldSvg());
        dom.appendChild(arrow);
      }
      if (this.isCollapsed) {
        arrow.classList.add("is-collapsed");
      } else {
        arrow.classList.remove("is-collapsed");
      }
      arrow.onmousedown = (e) => {
        e.preventDefault();
        view.dispatch({ effects: toggleCalloutEffect.of({ pos: this.pos }) });
      };
    } else if (arrow) {
      arrow.remove();
    }

    return true;
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
    const katex = getKatexSync();
    if (katex) {
      try {
        katex.render(this.latex, span, { throwOnError: false, displayMode: false });
      } catch {
        span.textContent = this.latex;
        span.classList.add("cm-preview-math-error");
      }
    } else {
      span.textContent = this.latex;
      span.classList.add("cm-preview-math-placeholder");
      loadKatex().then((k) => {
        if (!span.isConnected) return;
        span.classList.remove("cm-preview-math-placeholder");
        try {
          k.render(this.latex, span, { throwOnError: false, displayMode: false });
        } catch {
          span.textContent = this.latex;
          span.classList.add("cm-preview-math-error");
        }
      });
    }
    return span;
  }

  updateDOM(dom: HTMLElement): boolean {
    dom.innerHTML = "";
    dom.classList.remove("cm-preview-math-error", "cm-preview-math-placeholder");
    const katex = getKatexSync();
    if (katex) {
      try {
        katex.render(this.latex, dom, { throwOnError: false, displayMode: false });
      } catch {
        dom.textContent = this.latex;
        dom.classList.add("cm-preview-math-error");
      }
    } else {
      dom.textContent = this.latex;
      dom.classList.add("cm-preview-math-placeholder");
      loadKatex().then((k) => {
        if (!dom.isConnected) return;
        dom.classList.remove("cm-preview-math-placeholder");
        try {
          k.render(this.latex, dom, { throwOnError: false, displayMode: false });
        } catch {
          dom.textContent = this.latex;
          dom.classList.add("cm-preview-math-error");
        }
      });
    }
    return true;
  }

  eq(other: InlineMathWidget): boolean {
    return this.latex === other.latex;
  }

  ignoreEvent(): boolean {
    return false;
  }

  get estimatedHeight(): number {
    return -1;
  }
}

export class DisplayMathWidget extends WidgetType {
  constructor(readonly latex: string) {
    super();
  }

  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-preview-math-display";
    const katex = getKatexSync();
    if (katex) {
      try {
        katex.render(this.latex, div, { throwOnError: false, displayMode: true });
      } catch {
        div.textContent = this.latex;
        div.classList.add("cm-preview-math-error");
      }
    } else {
      div.textContent = this.latex;
      div.classList.add("cm-preview-math-placeholder");
      loadKatex().then((k) => {
        if (!div.isConnected) return;
        div.classList.remove("cm-preview-math-placeholder");
        try {
          k.render(this.latex, div, { throwOnError: false, displayMode: true });
        } catch {
          div.textContent = this.latex;
          div.classList.add("cm-preview-math-error");
        }
      });
    }
    return div;
  }

  updateDOM(dom: HTMLElement): boolean {
    dom.innerHTML = "";
    dom.classList.remove("cm-preview-math-error", "cm-preview-math-placeholder");
    const katex = getKatexSync();
    if (katex) {
      try {
        katex.render(this.latex, dom, { throwOnError: false, displayMode: true });
      } catch {
        dom.textContent = this.latex;
        dom.classList.add("cm-preview-math-error");
      }
    } else {
      dom.textContent = this.latex;
      dom.classList.add("cm-preview-math-placeholder");
      loadKatex().then((k) => {
        if (!dom.isConnected) return;
        dom.classList.remove("cm-preview-math-placeholder");
        try {
          k.render(this.latex, dom, { throwOnError: false, displayMode: true });
        } catch {
          dom.textContent = this.latex;
          dom.classList.add("cm-preview-math-error");
        }
      });
    }
    return true;
  }

  eq(other: DisplayMathWidget): boolean {
    return this.latex === other.latex;
  }

  ignoreEvent(): boolean {
    return false;
  }

  get estimatedHeight(): number {
    return 60;
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

    container.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey) return;
      const span = (e.target as HTMLElement).closest?.(".cm-preview-wikilink");
      if (!span) return;
      const target = span.getAttribute("data-wikilink-target");
      if (target === null) return;
      const section = span.getAttribute("data-wikilink-section") ?? undefined;
      const navigateToPage = view.state.facet(navigateToPageFacet);
      if (!navigateToPage) return;
      e.preventDefault();
      e.stopPropagation();
      const departurePos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? this.from;
      navigateToPage(target, section, departurePos);
    }, true);

    const parsed = parseTable(this.tableText);
    if (!parsed) return container;
    this.buildTable(container, view, parsed);
    return container;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const parsed = parseTable(this.tableText);
    if (!parsed) return false;
    dom.innerHTML = "";
    this.buildTable(dom, view, parsed);
    return true;
  }

  private buildTable(container: HTMLElement, view: EditorView, parsed: ParsedTable): void {
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
  }

  eq(other: EditableTableWidget): boolean {
    return this.tableText === other.tableText && this.from === other.from;
  }

  ignoreEvent(): boolean {
    return true;
  }

  get estimatedHeight(): number {
    const rowCount = this.tableText.split("\n").length - 1;
    return Math.max(60, rowCount * 33 + 40);
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
    readonly thumbnail: boolean = false,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = this.thumbnail
      ? "cm-preview-mermaid cm-preview-mermaid--thumbnail"
      : "cm-preview-mermaid";

    if (this.thumbnail) {
      container.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const svg = container.querySelector("svg");
        if (svg) {
          showMediaLightbox({ type: "svg", svg: svg.outerHTML });
        }
      });
    }

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

  updateDOM(dom: HTMLElement): boolean {
    if (this.thumbnail) {
      dom.classList.add("cm-preview-mermaid--thumbnail");
    } else {
      dom.classList.remove("cm-preview-mermaid--thumbnail");
    }

    const cached = getMermaidCached(this.source, this.theme);
    if (cached) {
      dom.innerHTML = cached;
      return true;
    }

    dom.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "cm-preview-mermaid-loading";
    loading.innerHTML = SPINNER_SVG;
    dom.appendChild(loading);

    renderMermaid(this.source, this.theme)
      .then((svg) => {
        if (!dom.isConnected) return;
        dom.innerHTML = svg;
      })
      .catch((err) => {
        if (!dom.isConnected) return;
        dom.innerHTML = "";
        const error = document.createElement("div");
        error.className = "cm-preview-mermaid-error";
        error.textContent = err instanceof Error ? err.message : String(err);
        dom.appendChild(error);
      });

    return true;
  }

  eq(other: MermaidWidget): boolean {
    return this.source === other.source && this.theme === other.theme && this.thumbnail === other.thumbnail;
  }

  ignoreEvent(): boolean {
    return true;
  }

  get estimatedHeight(): number {
    return this.thumbnail ? 136 : 200;
  }
}

export class HorizontalRuleWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement("hr");
    hr.className = "cm-preview-hr";
    hr.style.margin = "0";
    return hr;
  }

  eq(_other: HorizontalRuleWidget): boolean {
    return true;
  }

  ignoreEvent(): boolean {
    return false;
  }

  get estimatedHeight(): number {
    return 20;
  }
}

function applyAlignment(el: HTMLElement, alignment: Alignment | undefined) {
  if (alignment && alignment !== "default") {
    el.style.textAlign = alignment;
  }
}

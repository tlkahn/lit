import { type EditorView, WidgetType } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import { getCalloutIcon, toggleCalloutEffect } from "./callout";
import { applyQuotePrefixes, cellRoundTrip, parseTable, renderInlineMarkdown, serializeTable, type Alignment, type ParsedTable } from "./table";
import { renderMermaid, getMermaidCached } from "./mermaid";
import { showMediaLightbox } from "./lightbox";
import { navigateToPageFacet } from "./navigateToPageFacet";
import { widgetSync } from "./widgetSyncAnnotation";
import { getKatexSync, loadKatex } from "./katexLoader";
import { ESCAPED_DOLLAR_GLYPH } from "../../lib/escapedDollar";
import { katexOptions } from "../../lib/latexCompat";
import "katex/dist/katex.min.css";

const SPINNER_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><style>.spinner{transform-origin:center;animation:rotate .75s linear infinite}@keyframes rotate{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style><g class="spinner"><circle cx="12" cy="2.5" r="1.5" opacity=".14"/><circle cx="16.75" cy="3.77" r="1.5" opacity=".29"/><circle cx="20.23" cy="7.25" r="1.5" opacity=".43"/><circle cx="21.5" cy="12" r="1.5" opacity=".57"/><circle cx="20.23" cy="16.75" r="1.5" opacity=".71"/><circle cx="16.75" cy="20.23" r="1.5" opacity=".86"/><circle cx="12" cy="21.5" r="1.5"/></g></svg>`;

const failedImageSrcs = new Set<string>();
const boundHandlers = new WeakMap<HTMLImageElement, { onError: (e: Event) => void; onLoad: (e: Event) => void }>();

export function clearFailedImageCache(): void {
  failedImageSrcs.clear();
}

function nextViableSrc(srcs: string[], afterIdx: number): number {
  for (let i = afterIdx + 1; i < srcs.length; i++) {
    if (!failedImageSrcs.has(srcs[i]!)) return i;
  }
  return -1;
}

function bindCandidateWalk(img: HTMLImageElement, srcs: string[]): void {
  const prev = boundHandlers.get(img);
  if (prev) {
    img.removeEventListener("error", prev.onError);
    img.removeEventListener("load", prev.onLoad);
  }

  let idx = srcs.indexOf(img.getAttribute("src") ?? "");
  if (idx < 0) idx = 0;

  const onError = () => {
    const current = img.getAttribute("src") ?? "";
    failedImageSrcs.add(current);
    const next = nextViableSrc(srcs, idx);
    if (next >= 0) {
      idx = next;
      img.src = srcs[next]!;
    } else {
      img.removeAttribute("src");
      img.classList.add("cm-preview-image-error");
      img.removeEventListener("error", onError);
      img.removeEventListener("load", onLoad);
      boundHandlers.delete(img);
    }
  };

  const onLoad = () => {
    const loaded = img.getAttribute("src");
    if (loaded) failedImageSrcs.delete(loaded);
  };

  img.addEventListener("error", onError);
  img.addEventListener("load", onLoad);
  boundHandlers.set(img, { onError, onLoad });
}

export class ImageWidget extends WidgetType {
  readonly srcs: string[];

  constructor(
    srcs: string | string[],
    readonly alt: string,
    readonly thumbnail: boolean = false,
  ) {
    super();
    this.srcs = Array.isArray(srcs) ? srcs : [srcs];
  }

  private firstViableSrc(): string | undefined {
    return nextViableSrc(this.srcs, -1) >= 0
      ? this.srcs[nextViableSrc(this.srcs, -1)]
      : undefined;
  }

  private applyCandidates(img: HTMLImageElement): void {
    const viable = this.firstViableSrc();
    if (viable) {
      img.classList.remove("cm-preview-image-error");
      img.src = viable;
      bindCandidateWalk(img, this.srcs);
    } else {
      img.removeAttribute("src");
      img.classList.add("cm-preview-image-error");
    }
  }

  toDOM(): HTMLElement {
    if (this.thumbnail) {
      const container = document.createElement("div");
      container.className = "cm-preview-image-thumbnail";
      const img = document.createElement("img");
      img.alt = this.alt;
      this.applyCandidates(img);
      container.appendChild(img);
      container.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const currentSrc = img.getAttribute("src") ?? this.srcs[0] ?? "";
        showMediaLightbox({ type: "image", src: currentSrc });
      });
      return container;
    }
    const img = document.createElement("img");
    img.className = "cm-preview-image";
    img.alt = this.alt;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "300px";
    img.style.display = "block";
    this.applyCandidates(img);
    return img;
  }

  updateDOM(dom: HTMLElement): boolean {
    if (this.thumbnail) {
      const img = dom.querySelector("img");
      if (!img) return false;
      img.alt = this.alt;
      this.applyCandidates(img);
      return true;
    }
    const img = dom as HTMLImageElement;
    img.alt = this.alt;
    this.applyCandidates(img);
    return true;
  }

  eq(other: ImageWidget): boolean {
    if (this.srcs.length !== other.srcs.length) return false;
    for (let i = 0; i < this.srcs.length; i++) {
      if (this.srcs[i] !== other.srcs[i]) return false;
    }
    return this.alt === other.alt && this.thumbnail === other.thumbnail;
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
    return 20;
  }
}

function fitInlineMath(el: HTMLElement): void {
  requestAnimationFrame(() => {
    if (!el.isConnected) return;
    el.style.zoom = "";
    const natural = el.scrollWidth;
    const available = el.clientWidth;
    if (natural > available + 1) {
      el.style.zoom = String(Math.max(0.5, available / natural));
    }
  });
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
        katex.render(this.latex, span, katexOptions(false));
      } catch {
        span.textContent = this.latex;
        span.classList.add("cm-preview-math-error");
      }
      fitInlineMath(span);
    } else {
      span.textContent = this.latex;
      span.classList.add("cm-preview-math-placeholder");
      loadKatex().then((k) => {
        if (!span.isConnected) return;
        span.classList.remove("cm-preview-math-placeholder");
        try {
          k.render(this.latex, span, katexOptions(false));
        } catch {
          span.textContent = this.latex;
          span.classList.add("cm-preview-math-error");
        }
        fitInlineMath(span);
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
        katex.render(this.latex, dom, katexOptions(false));
      } catch {
        dom.textContent = this.latex;
        dom.classList.add("cm-preview-math-error");
      }
      fitInlineMath(dom);
    } else {
      dom.textContent = this.latex;
      dom.classList.add("cm-preview-math-placeholder");
      loadKatex().then((k) => {
        if (!dom.isConnected) return;
        dom.classList.remove("cm-preview-math-placeholder");
        try {
          k.render(this.latex, dom, katexOptions(false));
        } catch {
          dom.textContent = this.latex;
          dom.classList.add("cm-preview-math-error");
        }
        fitInlineMath(dom);
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

export class EscapedDollarWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-preview-escaped-dollar";
    span.textContent = ESCAPED_DOLLAR_GLYPH;
    return span;
  }

  eq(other: EscapedDollarWidget): boolean {
    return other instanceof EscapedDollarWidget;
  }

  ignoreEvent(): boolean {
    return false;
  }

  get estimatedHeight(): number {
    return -1;
  }
}

/**
 * Stand-in for the allowlisted void `<br>` / `<br/>` tag in live preview.
 * A real <br> element forces a soft line break inside the line's inline
 * content. estimatedHeight -1: let CM6 measure after sync (a fixed line
 * height would drift if the editor font size changes). No margin anywhere.
 */
export class HtmlBreakWidget extends WidgetType {
  toDOM(): HTMLElement {
    return document.createElement("br");
  }

  eq(other: HtmlBreakWidget): boolean {
    return other instanceof HtmlBreakWidget;
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
        katex.render(this.latex, div, katexOptions(true));
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
          k.render(this.latex, div, katexOptions(true));
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
        katex.render(this.latex, dom, katexOptions(true));
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
          k.render(this.latex, dom, katexOptions(true));
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

export type ModKeyEvent = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;

function isMod(e: ModKeyEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

/** Match historyKeymap's Undo: (meta|ctrl)+z without shift or alt. */
export function isModUndo(e: ModKeyEvent): boolean {
  return isMod(e) && e.key.toLowerCase() === "z" && !e.shiftKey && !e.altKey;
}

/** Match historyKeymap's Redo: (meta|ctrl)+y w/o shift, or (meta|ctrl)+shift+z. */
export function isModRedo(e: ModKeyEvent): boolean {
  if (isMod(e) && e.key.toLowerCase() === "y" && !e.shiftKey) return true;
  return (
    isMod(e) && e.key.toLowerCase() === "z" && e.shiftKey && !e.altKey
  );
}

function firstTextNode(cell: Node): Text | null {
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text | null;
}

/**
 * Caret offset into the single text node of an editing cell. Falls back to
 * end-of-text when there is no selection or the caret sits outside the cell.
 */
export function getCaretOffset(cell: Node): number {
  const sel = window.getSelection();
  const len = (cell.textContent ?? "").length;
  const text = firstTextNode(cell);
  if (!sel || sel.rangeCount === 0 || !text) return len;
  const range = sel.getRangeAt(0);
  if (range.startContainer === text) return range.startOffset;
  if (range.startContainer === cell) return range.startOffset <= 0 ? 0 : len;
  return len;
}

/** Place the caret at a clamped offset into the editing cell's text node. */
export function setCaretOffset(cell: Node, offset: number): void {
  const sel = window.getSelection();
  const text = firstTextNode(cell);
  if (!sel || !text) return;
  const range = document.createRange();
  const clamped = Math.max(0, Math.min(offset, text.length));
  range.setStart(text, clamped);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

interface TableCommitCtx {
  parsed: ParsedTable;
  from: number;
  rawLength: number;
  prefixes: string[];
}

interface TableResume {
  row: string;
  col: string;
  offset: number;
}

/** Mutable per-container commit context; cell listeners read at call time. */
const tableCtx = new WeakMap<HTMLElement, TableCommitCtx>();

/** Last-wins pending focus resume after updateDOM / history (CM may reparent). */
const pendingResume = new WeakMap<HTMLElement, TableResume>();

/** Cells currently receiving a silent focus restore (skip select-all focus handler). */
const silentFocusCells = new WeakSet<HTMLElement>();


function bindTableCtx(
  container: HTMLElement,
  parsed: ParsedTable,
  from: number,
  rawLength: number,
  prefixes: string[],
): TableCommitCtx {
  const next: TableCommitCtx = { parsed, from, rawLength, prefixes };
  const existing = tableCtx.get(container);
  if (existing) {
    Object.assign(existing, next);
    return existing;
  }
  tableCtx.set(container, next);
  return next;
}

function cellValueAt(parsed: ParsedTable, row: number, col: number): string {
  if (row === 0) return parsed.headers[col] ?? "";
  return parsed.rows[row - 1]?.[col] ?? "";
}

/** Shape = header count + body row count + per-row column count. */
function domShapeMatches(dom: HTMLElement, parsed: ParsedTable): boolean {
  const headers = dom.querySelectorAll("thead th");
  if (headers.length !== parsed.headers.length) return false;
  if (headers.length !== parsed.alignments.length) return false;
  const bodyRows = dom.querySelectorAll("tbody tr");
  if (bodyRows.length !== parsed.rows.length) return false;
  for (let r = 0; r < parsed.rows.length; r++) {
    const cells = bodyRows[r]!.querySelectorAll("td");
    if (cells.length !== parsed.rows[r]!.length) return false;
  }
  // Require addressable cells so in-place updates can key by data-row/col.
  const addressed = dom.querySelectorAll("[data-row][data-col]");
  const expected = parsed.headers.length + parsed.rows.reduce((n, row) => n + row.length, 0);
  return addressed.length === expected;
}

function updateCellsInPlace(dom: HTMLElement, parsed: ParsedTable): void {
  const cells = dom.querySelectorAll<HTMLElement>("[data-row][data-col]");
  for (const cell of cells) {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
    const v = cellValueAt(parsed, row, col);
    const alignment = parsed.alignments[col];
    const isEditingFlag = cell.dataset.editing === "1";
    const isFocused = cell.ownerDocument.activeElement === cell;

    if (isEditingFlag && isFocused) {
      // Actively editing: keep node identity; only rewrite on real divergence.
      cell.dataset.raw = v;
      if (cellRoundTrip(cell.textContent ?? "") !== v) {
        const offset = getCaretOffset(cell);
        cell.textContent = v;
        setCaretOffset(cell, offset);
      }
      applyAlignment(cell, alignment);
      continue;
    }

    if (isEditingFlag && !isFocused) {
      // Stale editing flag: fall through to display rendering.
      delete cell.dataset.editing;
    }

    if (cell.dataset.raw !== v) {
      cell.dataset.raw = v;
      cell.innerHTML = renderInlineMarkdown(v);
    }
    applyAlignment(cell, alignment);
  }
}

function captureEditingResume(dom: HTMLElement): TableResume | null {
  const active = dom.querySelector<HTMLElement>("[data-editing='1']");
  if (!active || active.ownerDocument.activeElement !== active) return null;
  if (active.dataset.row == null || active.dataset.col == null) return null;
  return {
    row: active.dataset.row,
    col: active.dataset.col,
    offset: getCaretOffset(active),
  };
}

function restoreTableFocus(container: HTMLElement): void {
  const pending = pendingResume.get(container);
  if (!pending) return;
  pendingResume.delete(container);
  if (!container.isConnected) return;

  const doc = container.ownerDocument;
  const ae = doc.activeElement;
  const cell = container.querySelector(
    `[data-row="${pending.row}"][data-col="${pending.col}"]`,
  ) as HTMLElement | null;

  // Already focused on the right cell - just clamp caret if needed.
  if (cell && ae === cell) {
    setCaretOffset(cell, pending.offset);
    return;
  }

  // Don't steal focus if something outside the container took it. CM reparent
  // drops focus to body; .cm-content is also a steal we reverse while editing.
  const aeIsEditorChrome =
    !ae ||
    ae === doc.body ||
    (ae instanceof HTMLElement &&
      (ae.classList.contains("cm-content") || ae.classList.contains("cm-editor")));
  if (ae && !aeIsEditorChrome && !container.contains(ae)) return;
  if (!cell) return;

  // Silent focus: skip the normal focus handler's select-all / collapse-to-end.
  silentFocusCells.add(cell);
  cell.dataset.editing = "1";
  const raw = cell.dataset.raw ?? "";
  if (cell.textContent !== raw) cell.textContent = raw;
  cell.focus({ preventScroll: true });
  setCaretOffset(cell, pending.offset);
  queueMicrotask(() => silentFocusCells.delete(cell));
}

function queueTableFocusRestore(container: HTMLElement, resume: TableResume): void {
  // Last-wins: later rebuilds overwrite the pending slot; each queues a microtask,
  // but only the final pending value is applied (earlier tasks no-op after delete).
  pendingResume.set(container, resume);
  queueMicrotask(() => restoreTableFocus(container));
}

export class EditableTableWidget extends WidgetType {
  constructor(
    readonly tableText: string,
    readonly from: number,
    readonly rawLength: number,
    readonly prefixes: string[],
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
      if (!span) {
        view.dispatch({
          selection: { anchor: view.posAtDOM(container) },
          annotations: widgetSync.of(true),
        });
        return;
      }
      const target = span.getAttribute("data-wikilink-target");
      if (target === null) return;
      const section = span.getAttribute("data-wikilink-section") ?? undefined;
      const navigateToPage = view.state.facet(navigateToPageFacet);
      if (!navigateToPage) return;
      e.preventDefault();
      e.stopPropagation();
      const departurePos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.posAtDOM(container);
      navigateToPage(target, section, departurePos);
    }, true);

    const parsed = parseTable(this.tableText);
    if (!parsed) return container;
    bindTableCtx(container, parsed, this.from, this.rawLength, this.prefixes);
    this.buildTable(container, view, parsed);
    return container;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const parsed = parseTable(this.tableText);
    if (!parsed) return false;

    // Always refresh commit context first so in-place cell listeners see new coords.
    bindTableCtx(dom, parsed, this.from, this.rawLength, this.prefixes);

    // Capture before any DOM work: CM tile.sync may reparent the container and
    // drop focus to <body> even when cell identity is preserved (length change).
    const resumeAtEntry = captureEditingResume(dom);

    if (domShapeMatches(dom, parsed)) {
      updateCellsInPlace(dom, parsed);
      if (resumeAtEntry) {
        // Prefer post-update caret (divergence path may have clamped it).
        const cell = dom.querySelector<HTMLElement>(
          `[data-row="${resumeAtEntry.row}"][data-col="${resumeAtEntry.col}"]`,
        );
        const offset =
          cell && document.activeElement === cell
            ? getCaretOffset(cell)
            : resumeAtEntry.offset;
        queueTableFocusRestore(dom, { ...resumeAtEntry, offset });
      }
      return true;
    }

    return this.rebuildTable(dom, view, parsed);
  }

  /** Full rebuild path for shape changes. Never focuses synchronously. */
  private rebuildTable(dom: HTMLElement, view: EditorView, parsed: ParsedTable): boolean {
    const active = dom.querySelector(
      "[data-editing='1']",
    ) as HTMLElement | null;
    const focusedEditing =
      active && active.ownerDocument.activeElement === active ? active : null;
    const resume =
      focusedEditing &&
      focusedEditing.dataset.row != null &&
      focusedEditing.dataset.col != null
        ? {
            row: focusedEditing.dataset.row,
            col: focusedEditing.dataset.col,
            offset: getCaretOffset(focusedEditing),
          }
        : null;

    dom.dataset.rebuilding = "1";
    try {
      dom.innerHTML = "";
      this.buildTable(dom, view, parsed);
    } finally {
      delete dom.dataset.rebuilding;
    }

    if (resume) {
      // Defer past CM's synchronous build+sync+updateSelection so focus sticks.
      queueTableFocusRestore(dom, resume);
    }
    return true;
  }

  private buildTable(container: HTMLElement, view: EditorView, parsed: ParsedTable): void {
    const table = document.createElement("table");
    table.className = "cm-preview-table";

    const commitCell = (row: number, col: number, nextValue: string, userEvent = "input") => {
      const ctx = tableCtx.get(container);
      if (!ctx) return;
      const updated: ParsedTable = {
        headers: [...ctx.parsed.headers],
        alignments: [...ctx.parsed.alignments],
        rows: ctx.parsed.rows.map((r) => [...r]),
      };
      if (row === 0) {
        updated.headers[col] = nextValue;
      } else {
        updated.rows[row - 1]![col] = nextValue;
      }
      const newMarkdown = applyQuotePrefixes(serializeTable(updated), ctx.prefixes);
      view.dispatch({
        changes: { from: ctx.from, to: ctx.from + ctx.rawLength, insert: newMarkdown },
        userEvent,
      });
    };

    const makeCell = (
      tag: "th" | "td",
      value: string,
      i: number,
      row: number,
    ) =>
      createEditableCell(
        tag,
        value,
        parsed.alignments[i],
        (next, userEvent) => commitCell(row, i, next, userEvent),
        view,
      );

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    parsed.headers.forEach((header, i) => {
      const th = makeCell("th", header, i, 0);
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
          const td = makeCell("td", cell, i, rowIndex);
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
    return (
      this.tableText === other.tableText &&
      this.from === other.from &&
      this.rawLength === other.rawLength &&
      this.prefixes.length === other.prefixes.length &&
      this.prefixes.every((p, i) => p === other.prefixes[i])
    );
  }

  ignoreEvent(): boolean {
    return true;
  }


  get estimatedHeight(): number {
    const rowCount = this.tableText.split("\n").length - 1;
    return Math.max(60, rowCount * 33 + 40);
  }
}

function userEventFromInput(e: InputEvent): string {
  const inputType = e.inputType ?? "";
  if (inputType.startsWith("delete")) {
    return inputType.includes("Backward") ? "delete.backward" : "delete.forward";
  }
  return "input.type";
}

function createEditableCell(
  tag: "th" | "td",
  value: string,
  alignment: Alignment | undefined,
  onCommit: (next: string, userEvent: string) => void,
  view: EditorView,
): HTMLTableCellElement {
  const cell = document.createElement(tag);
  cell.innerHTML = renderInlineMarkdown(value);
  cell.dataset.raw = value;
  cell.setAttribute("contenteditable", "true");
  cell.spellcheck = false;
  applyAlignment(cell, alignment);

  let selectAllOnFocus = false;

  const commitIfChanged = (next: string, userEvent: string): boolean => {
    const raw = cell.dataset.raw ?? "";
    if (next === raw) return false;
    cell.dataset.raw = next;
    onCommit(next, userEvent);
    return true;
  };

  cell.addEventListener("mousedown", () => {
    selectAllOnFocus = cell.childElementCount > 0;
  });

  cell.addEventListener("focus", () => {
    // Silent restore path: keep text + caret; caller already set them.
    if (silentFocusCells.has(cell)) {
      cell.dataset.editing = "1";
      return;
    }
    const raw = cell.dataset.raw ?? "";
    cell.dataset.editing = "1";
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

  cell.addEventListener("input", (e) => {
    const ev = e as InputEvent;
    if (ev.isComposing) return;
    cell.dataset.raw = cell.textContent ?? "";
    onCommit(cell.dataset.raw, userEventFromInput(ev));
  });

  cell.addEventListener("compositionend", () => {
    const next = cell.textContent ?? "";
    commitIfChanged(next, "input.type");
  });

  cell.addEventListener("blur", () => {
    // Skip commit + display re-render while the container is mid-rebuild
    // (WKWebView can fire blur when cells are detached).
    const container = cell.closest(".cm-preview-table-container") as HTMLElement | null;
    if (container?.dataset.rebuilding === "1") return;

    delete cell.dataset.editing;
    const next = cell.textContent ?? "";
    commitIfChanged(next, "input");
    cell.innerHTML = renderInlineMarkdown(cell.dataset.raw ?? "");
  });

  const hardenFocusAfterHistory = (preOffset: number) => {
    // updateDOM already queues a restore with the clamped caret when the doc
    // changed. Only fill in if nothing is pending (e.g. undo was a no-op).
    const container = cell.closest(".cm-preview-table-container") as HTMLElement | null;
    if (
      container &&
      !pendingResume.has(container) &&
      cell.dataset.row != null &&
      cell.dataset.col != null &&
      cell.dataset.editing === "1"
    ) {
      const len = (cell.textContent ?? "").length;
      queueTableFocusRestore(container, {
        row: cell.dataset.row,
        col: cell.dataset.col,
        offset: Math.max(0, Math.min(preOffset, len)),
      });
    }
  };

  cell.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const next = cell.textContent ?? "";
      commitIfChanged(next, "input");
      cell.blur();
    } else if (isModUndo(e)) {
      e.preventDefault();
      e.stopPropagation();
      const preOffset = getCaretOffset(cell);
      undo(view);
      hardenFocusAfterHistory(preOffset);
    } else if (isModRedo(e)) {
      e.preventDefault();
      e.stopPropagation();
      const preOffset = getCaretOffset(cell);
      redo(view);
      hardenFocusAfterHistory(preOffset);
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
  constructor(readonly variant: "short" | "full" = "full") {
    super();
  }

  toDOM(): HTMLElement {
    const hr = document.createElement("hr");
    hr.className = this.variant === "short" ? "cm-preview-hr cm-preview-hr-short" : "cm-preview-hr";
    hr.style.margin = "0";
    return hr;
  }

  eq(other: HorizontalRuleWidget): boolean {
    return this.variant === other.variant;
  }

  ignoreEvent(): boolean {
    return false;
  }

  get estimatedHeight(): number {
    return this.variant === "short" ? 40 : 20;
  }
}

export class PageBreakWidget extends WidgetType {
  constructor(readonly pageNumber: number) {
    super();
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-preview-page-break";
    container.setAttribute("role", "separator");
    container.setAttribute("aria-label", `Page ${this.pageNumber}`);

    const leftRule = document.createElement("span");
    leftRule.className = "cm-preview-page-break-rule";

    const label = document.createElement("span");
    label.className = "cm-preview-page-break-label";
    label.textContent = `Page ${this.pageNumber}`;

    const rightRule = document.createElement("span");
    rightRule.className = "cm-preview-page-break-rule";

    container.appendChild(leftRule);
    container.appendChild(label);
    container.appendChild(rightRule);
    return container;
  }

  updateDOM(dom: HTMLElement): boolean {
    const label = dom.querySelector(".cm-preview-page-break-label");
    if (!label) return false;
    label.textContent = `Page ${this.pageNumber}`;
    dom.setAttribute("aria-label", `Page ${this.pageNumber}`);
    return true;
  }

  eq(other: PageBreakWidget): boolean {
    return this.pageNumber === other.pageNumber;
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
  } else {
    el.style.textAlign = "";
  }
}

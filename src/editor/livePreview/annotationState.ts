import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, type PluginValue, keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { parseAnnotations, listAnnotations, type Annotation } from "../../lib/ipc";
import { type AnnotationDisplayMode } from "../../stores/preferences";
import { isCursorOnLine } from "./proximity";
import { PillWidget, MarkerWidget, CalloutWidget, ThreadWidget, annotationFoldField, threadTurnField, setThreadTurnEffect, firingAnnotationsField, firingRangeField, llmLockedField, setLlmLockedEffect, setFiringAnnotation, clearFiringAnnotation, toggleAnnotationFoldEffect } from "./annotationWidgets";
import { isPerfEnabled, perfMark, perfMeasure } from "./perf";
import { useModalLockStore } from "../../stores/modalLock";
import { useWorkspaceStore } from "../../stores/workspace";
import { scopeHighlightExtension } from "./scopeHighlight";
import { markDecorationExtension } from "./markDecorations";
import { escapeAnnotationKeymap } from "./escapeAnnotation";
import { fireAnnotation } from "../../lib/fireOrchestrator";
import { threadFollowup } from "../../lib/threadFollowup";
import { copyThreadExport, deleteThread } from "../../lib/threadExport";
import type { ThreadFollowupEventDetail, ThreadExportEventDetail, ThreadDeleteEventDetail } from "./annotationWidgets";

export const setDisplayMode = StateEffect.define<AnnotationDisplayMode>();

export const displayModeField = StateField.define<AnnotationDisplayMode>({
  create: () => "pill",
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setDisplayMode)) return e.value;
    }
    return value;
  },
});

export const setAnnotationData = StateEffect.define<Annotation[]>();

export const annotationDataField = StateField.define<Annotation[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setAnnotationData)) return e.value;
    }
    return value;
  },
});

/** Build a fingerprint from annotation types+bodies (position-independent). */
function buildAnnotationFingerprint(annotations: Annotation[]): string {
  return annotations
    .map((a) => `${a.annotation_type}:${a.body ?? ""}`)
    .join("\n");
}

type IndexedGroup = Array<{ uuid: string; char_start: number }>;

/** Group indexed annotations by (type, body) for fuzzy matching. */
function buildIndexedGroups(indexed: Array<{ annotation_type: string; body: string | null; uuid: string; char_start: number }>): Map<string, IndexedGroup> {
  const groups = new Map<string, IndexedGroup>();
  for (const ia of indexed) {
    const key = `${ia.annotation_type}:${ia.body ?? ""}`;
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push({ uuid: ia.uuid, char_start: ia.char_start });
  }
  return groups;
}

/** Enrich annotations with UUIDs using fuzzy (type+body) matching + proximity tiebreaker. */
function enrichWithGroups(annotations: Annotation[], groups: Map<string, IndexedGroup>): void {
  for (const ann of annotations) {
    const key = `${ann.annotation_type}:${ann.body ?? ""}`;
    const candidates = groups.get(key);
    if (!candidates || candidates.length === 0) continue;
    let best = candidates[0]!;
    let bestDist = Math.abs(best.char_start - ann.char_start);
    for (let i = 1; i < candidates.length; i++) {
      const d = Math.abs(candidates[i]!.char_start - ann.char_start);
      if (d < bestDist) { best = candidates[i]!; bestDist = d; }
    }
    ann.uuid = best.uuid;
  }
}

export const annotationPlugin = ViewPlugin.fromClass(
  class {
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private lastDocStr = "";
    private lastAnnotationFingerprint = "";
    private lastNodeId: string | null = null;
    private lastIndexedGroups: Map<string, IndexedGroup> = new Map();

    constructor(private view: EditorView) {
      this.lastDocStr = view.state.doc.toString();
      this.fireIPC();
    }

    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      this.scheduleIPC();
    }

    private scheduleIPC() {
      if (this.debounceTimer != null) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.fireIPC();
      }, 150);
    }

    private async fireIPC() {
      const docStr = this.view.state.doc.toString();
      this.lastDocStr = docStr;
      try {
        const annotations = await parseAnnotations(docStr);
        if (this.view.state.doc.toString() !== this.lastDocStr) return;

        const nodeId = useWorkspaceStore.getState().currentPagePath;
        if (nodeId && annotations.length > 0) {
          try {
            const fingerprint = buildAnnotationFingerprint(annotations);
            const nodeChanged = nodeId !== this.lastNodeId;
            const fpChanged = fingerprint !== this.lastAnnotationFingerprint;

            if (nodeChanged || fpChanged) {
              const indexed = await listAnnotations(nodeId);
              if (this.view.state.doc.toString() !== this.lastDocStr) return;
              this.lastIndexedGroups = buildIndexedGroups(indexed);
              this.lastAnnotationFingerprint = fingerprint;
              this.lastNodeId = nodeId;
            }

            enrichWithGroups(annotations, this.lastIndexedGroups);
          } catch { /* best-effort enrichment */ }
        }

        const prev = this.view.state.field(annotationDataField);
        if (annotations.length === 0 && prev.length === 0) return;
        this.view.dispatch({ effects: setAnnotationData.of(annotations) });
        window.dispatchEvent(new CustomEvent("lit:annotations-changed"));
      } catch { /* IPC failure is non-fatal */ }
    }

    destroy() {
      if (this.debounceTimer != null) clearTimeout(this.debounceTimer);
    }
  },
);

function findAnnotationForRange(
  annotations: Annotation[],
  from: number,
  to: number,
): Annotation | undefined {
  return annotations.find(
    (a) => a.char_start === from && a.char_end === to,
  );
}

export interface BuildAnnotationDecorationsResult {
  decorations: DecorationSet;
  cursorSensitiveLines: Set<number>;
}

const VISIBLE_RANGE_BUFFER = 5000;

/**
 * Build annotation decorations bounded to the editor's visible ranges.
 *
 * Returns the decoration set plus the set of line numbers that an annotation
 * node spans (cursor-sensitive). Sensitive lines are recorded even when the
 * cursor currently sits on the annotation (so moving off it can trigger a
 * rebuild) — hence line tracking runs before the `isCursorOnLine` guard.
 */
export function buildAnnotationDecorations(view: EditorView): BuildAnnotationDecorationsResult {
  const { state } = view;
  const annotations = state.field(annotationDataField);
  const cursorSensitiveLines = new Set<number>();
  if (annotations.length === 0) {
    return { decorations: Decoration.none, cursorSensitiveLines };
  }

  const mode = state.field(displayModeField);
  const firingSet = state.field(firingAnnotationsField, false) ?? new Set<number>();
  const llmLocked = state.field(llmLockedField, false) ?? false;

  const docLen = state.doc.length;
  const decos: { from: number; to: number; deco: Decoration }[] = [];
  const tree = syntaxTree(state);

  // Buffered windows of adjacent visible ranges can overlap (e.g. around a code
  // fold), so the same annotation node may be entered once per range. Dedupe by
  // node start offset (unique per annotation node) so line tracking, the cursor
  // guard, and the decoration push each run at most once per node.
  const seen = new Set<number>();

  for (const range of view.visibleRanges) {
    const from = Math.max(0, range.from - VISIBLE_RANGE_BUFFER);
    const to = Math.min(docLen, range.to + VISIBLE_RANGE_BUFFER);
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "InlineAnnotation" && node.name !== "BlockAnnotation") return;

        const nodeFrom = node.from;
        const nodeTo = node.to;
        if (nodeFrom < 0 || nodeTo > docLen || nodeFrom >= nodeTo) return;

        if (seen.has(nodeFrom)) return;
        seen.add(nodeFrom);

        // Track every line spanned by this annotation node (cursor-sensitive).
        const startLine = state.doc.lineAt(nodeFrom).number;
        const endLine = state.doc.lineAt(nodeTo).number;
        for (let l = startLine; l <= endLine; l++) cursorSensitiveLines.add(l);

        if (isCursorOnLine(state, nodeFrom, nodeTo)) return;

        const ann = findAnnotationForRange(annotations, nodeFrom, nodeTo);
        if (!ann) return;

        const text = state.doc.sliceString(nodeFrom, nodeTo);
        const isMultiLine = text.includes("\n");

        // A multiline block annotation's callout is a line-break-spanning
        // replacement, which CodeMirror forbids from plugin sources;
        // splitAnnotationDecorations would route it to the discarded "block"
        // subset. annotationBlockDecorationField (a StateField) is the sole
        // producer of that callout, so skip building it here — the line
        // tracking above keeps these lines cursor-sensitive.
        if (node.name === "BlockAnnotation" && isMultiLine) return;

        const isFiring = firingSet.has(nodeFrom);
        const widget = mode === "footnote" ? new MarkerWidget(ann, isFiring, llmLocked) : new PillWidget(ann, isFiring, llmLocked);
        decos.push({
          from: nodeFrom,
          to: nodeTo,
          deco: Decoration.replace({ widget }),
        });
      },
    });
  }

  decos.sort((a, b) => a.from - b.from || a.to - b.to);
  return {
    decorations: Decoration.set(decos.map((d) => d.deco.range(d.from, d.to))),
    cursorSensitiveLines,
  };
}

/**
 * Split a built annotation decoration set into the line-safe subset (inline /
 * single-line replacements) and the line-break-spanning subset (expanded
 * multiline callouts).
 *
 * CodeMirror forbids line-break-spanning and block replacements from
 * `ViewPlugin` sources (it throws "Decorations that replace line breaks may not
 * be specified via plugins"). The plugin therefore renders only `inline`, while
 * `block` is delivered through `annotationBlockDecorationField` (a StateField,
 * which is permitted to replace line breaks).
 */
function splitAnnotationDecorations(
  set: DecorationSet,
  doc: EditorView["state"]["doc"],
): { inline: DecorationSet; block: DecorationSet } {
  const inline: { from: number; to: number; deco: Decoration }[] = [];
  const block: { from: number; to: number; deco: Decoration }[] = [];
  const iter = set.iter();
  while (iter.value) {
    const lineEnd = doc.lineAt(iter.from).to;
    const target = iter.to > lineEnd ? block : inline;
    target.push({ from: iter.from, to: iter.to, deco: iter.value });
    iter.next();
  }
  return {
    inline: Decoration.set(inline.map((d) => d.deco.range(d.from, d.to))),
    block: Decoration.set(block.map((d) => d.deco.range(d.from, d.to))),
  };
}

class AnnotationDecorationPluginValue implements PluginValue {
  /**
   * Unsafe full superset (inline + block) — exposed for inspection/tests only.
   * Deliberately NOT named `decorations` to avoid shadowing CM6's reserved
   * PluginValue.decorations convention: it contains line-break-spanning block
   * replacements that CM6 forbids from plugins. The plugin renders
   * `inlineDecorations` via the explicit accessor below; block ones go via field.
   */
  allDecorations: DecorationSet;
  /** Line-safe subset actually rendered by the plugin (block ones go via field). */
  inlineDecorations: DecorationSet;
  cursorSensitiveLines: Set<number>;

  constructor(view: EditorView) {
    const result = buildAnnotationDecorations(view);
    this.allDecorations = result.decorations;
    this.inlineDecorations = splitAnnotationDecorations(result.decorations, view.state.doc).inline;
    this.cursorSensitiveLines = result.cursorSensitiveLines;
  }

  private rebuild(view: EditorView, reason: string) {
    if (isPerfEnabled()) perfMark("annotationDeco:rebuild:start");
    const result = buildAnnotationDecorations(view);
    this.allDecorations = result.decorations;
    this.inlineDecorations = splitAnnotationDecorations(result.decorations, view.state.doc).inline;
    this.cursorSensitiveLines = result.cursorSensitiveLines;
    if (isPerfEnabled()) {
      const m = perfMeasure("annotationDeco:rebuild", "annotationDeco:rebuild:start");
      console.debug(`[annotationDeco] rebuild (${reason}) ${m ? m.duration.toFixed(1) + "ms" : ""}`);
    }
  }

  update(update: ViewUpdate) {
    perfMark("annotationDeco:update:start");
    // The background parser advancing (Language.setState) carries no docChange,
    // viewport change, effect, or selection; detect it via tree-identity change
    // so late-frontier annotations on large docs become visible without
    // interaction.
    const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state);
    if (update.docChanged || update.viewportChanged || treeChanged) {
      this.rebuild(update.view, update.docChanged ? "docChanged" : update.viewportChanged ? "viewportChanged" : "syntaxTree");
    } else if (update.transactions.some((tr) => hasAnnotationEffect(tr))) {
      this.rebuild(update.view, "effect");
    } else if (update.selectionSet) {
      const oldLine = update.startState.doc.lineAt(update.startState.selection.main.head).number;
      const newLine = update.state.doc.lineAt(update.state.selection.main.head).number;
      if (this.cursorSensitiveLines.has(oldLine) || this.cursorSensitiveLines.has(newLine)) {
        this.rebuild(update.view, `selection L${oldLine}→L${newLine} (sensitive)`);
      } else if (isPerfEnabled()) {
        console.debug(`[annotationDeco] skip: selection L${oldLine}→L${newLine} (plain)`);
        perfMark("annotationDeco:skip:selection");
      }
    } else if (isPerfEnabled()) {
      perfMark("annotationDeco:skip:no-trigger");
    }
    perfMeasure("annotationDeco:update", "annotationDeco:update:start");
  }
}

export const annotationDecorationPlugin = ViewPlugin.fromClass(
  AnnotationDecorationPluginValue,
  { decorations: (v) => v.inlineDecorations },
);

/**
 * Returns true when a transaction carries an annotation-relevant state effect
 * (the same effects that trigger a plugin rebuild).
 */
export function hasAnnotationEffect(tr: { effects: readonly StateEffect<unknown>[] }): boolean {
  return tr.effects.some((e) =>
    e.is(setAnnotationData) ||
    e.is(setDisplayMode) ||
    e.is(toggleAnnotationFoldEffect) ||
    e.is(setFiringAnnotation) ||
    e.is(clearFiringAnnotation) ||
    e.is(setLlmLockedEffect) ||
    e.is(setThreadTurnEffect),
  );
}

/**
 * Builds ONLY the line-break-spanning annotation decorations (expanded multiline
 * callouts) over the full document. These cannot be delivered via the
 * `annotationDecorationPlugin` (CodeMirror forbids line-break-spanning
 * replacements from plugins), so they live in this StateField instead.
 *
 * Mirrors `buildAnnotationDecorations` but is viewport-independent (block
 * annotations are few and the field has no access to view geometry).
 */
/** State shape for `annotationBlockDecorationField`. */
export interface BlockDecorationState {
  /** The DecorationSet containing line-break-spanning block annotation callouts. */
  decorations: DecorationSet;
  /**
   * Document line numbers spanned by multiline block annotations. Used by the
   * field's selection guard to skip rebuilds when the cursor moves between
   * lines that no block annotation touches.
   */
  blockSensitiveLines: Set<number>;
}

function buildAnnotationBlockDecorations(state: EditorView["state"]): BlockDecorationState {
  const annotations = state.field(annotationDataField);
  const blockSensitiveLines = new Set<number>();
  if (annotations.length === 0) {
    return { decorations: Decoration.none, blockSensitiveLines };
  }

  const firingSet = state.field(firingAnnotationsField, false) ?? new Set<number>();
  const llmLocked = state.field(llmLockedField, false) ?? false;
  const foldState = state.field(annotationFoldField, false);
  const turnState = state.field(threadTurnField, false);

  const docLen = state.doc.length;
  const decos: { from: number; to: number; deco: Decoration }[] = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "BlockAnnotation") return;
      const from = node.from;
      const to = node.to;
      if (from < 0 || to > docLen || from >= to) return;
      if (!state.doc.sliceString(from, to).includes("\n")) return;

      // Track every line spanned by this multiline block annotation
      // (cursor-sensitive) BEFORE the isCursorOnLine early-return, so moving the
      // cursor OFF a block line still triggers a rebuild that restores the callout.
      const startLine = state.doc.lineAt(from).number;
      const endLine = state.doc.lineAt(to).number;
      for (let l = startLine; l <= endLine; l++) blockSensitiveLines.add(l);

      if (isCursorOnLine(state, from, to)) return;

      const ann = findAnnotationForRange(annotations, from, to);
      if (!ann) return;

      const isCollapsed = foldState?.get(from) ?? false;
      const isFiring = firingSet.has(from);
      const widget =
        ann.annotation_type === "thread"
          ? new ThreadWidget(ann, turnState?.get(from) ?? 0, isCollapsed, from, isFiring)
          : new CalloutWidget(ann, isCollapsed, from, isFiring, llmLocked);
      decos.push({
        from,
        to,
        deco: Decoration.replace({ widget }),
      });
    },
  });

  decos.sort((a, b) => a.from - b.from || a.to - b.to);
  return {
    decorations: Decoration.set(decos.map((d) => d.deco.range(d.from, d.to))),
    blockSensitiveLines,
  };
}

/**
 * Returns true when a tree-identity change (parser progress) warrants
 * rebuilding the block decorations. When there are no annotations, or the
 * materialized tree on `startState` already covered all annotation positions,
 * the parser can only be extending into territory that contains no block
 * annotations — skip the (unbounded) full-tree walk.
 *
 * Uses `syntaxTree(startState).length` (the materialized StateField tree) rather
 * than `syntaxTreeAvailable` (which queries the live parse context and may
 * reflect progress that hasn't yet been committed to the StateField).
 */
export function shouldRebuildBlocksOnTreeChange(
  startState: EditorView["state"],
  annotations: Annotation[],
): boolean {
  if (annotations.length === 0) return false;
  const maxEnd = annotations.reduce((m, a) => Math.max(m, a.char_end), 0);
  return syntaxTree(startState).length < maxEnd;
}

/**
 * Delivers line-break-spanning annotation callouts via a `StateField` (not the
 * plugin) because CodeMirror only permits such replacements from field/facet
 * sources. Recomputes on doc change and annotation effects. For selection-only
 * transactions it applies a cursor-sensitivity guard analogous to the plugin's
 * (see `AnnotationDecorationPluginValue.update`): the rebuild — an unbounded
 * full-tree walk — is skipped unless the old or new cursor line spans a block
 * annotation, so plain cursor moves between non-block lines cost nothing while
 * moving onto/off a block line still updates the `isCursorOnLine` suppression.
 *
 * Value shape: `BlockDecorationState` — `.decorations` for the DecorationSet,
 * `.blockSensitiveLines` for the cursor guard set.
 */
export const annotationBlockDecorationField = StateField.define<BlockDecorationState>({
  create(state) {
    return buildAnnotationBlockDecorations(state);
  },
  update(value, tr) {
    if (tr.docChanged || hasAnnotationEffect(tr)) {
      return buildAnnotationBlockDecorations(tr.state);
    }
    // Parser progress (Language.setState advancing the tree) carries no
    // docChange or annotation effect. Only rebuild if the old tree hadn't yet
    // covered all annotation positions — otherwise the extension can't reveal
    // new block nodes.
    if (syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      if (shouldRebuildBlocksOnTreeChange(tr.startState, tr.startState.field(annotationDataField))) {
        return buildAnnotationBlockDecorations(tr.state);
      }
      return value;
    }
    if (tr.selection) {
      const oldLine = tr.startState.doc.lineAt(tr.startState.selection.main.head).number;
      const newLine = tr.state.doc.lineAt(tr.state.selection.main.head).number;
      if (value.blockSensitiveLines.has(oldLine) || value.blockSensitiveLines.has(newLine)) {
        return buildAnnotationBlockDecorations(tr.state);
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field, (v) => v.decorations),
});

export function findAnnotationAtCursor(
  annotations: Annotation[],
  pos: number,
): Annotation | undefined {
  return annotations.find((a) => pos >= a.char_start && pos < a.char_end);
}

const fireAnnotationPlugin = ViewPlugin.fromClass(
  class {
    private handler: (e: Event) => void;
    private disposeFireCleanup: (() => void) | null = null;
    constructor(private view: EditorView) {
      this.handler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.annotation) {
          const result = fireAnnotation({ view: this.view, annotation: detail.annotation });
          result.then((cleanup) => {
            if (typeof cleanup === "function") this.disposeFireCleanup = cleanup;
          }).catch((err) => {
            console.warn("fireAnnotation failed:", err);
          });
        }
      };
      window.addEventListener("lit:fire-annotation", this.handler);
    }
    update(update: ViewUpdate) {
      this.view = update.view;
    }
    destroy() {
      window.removeEventListener("lit:fire-annotation", this.handler);
      this.disposeFireCleanup?.();
      this.disposeFireCleanup = null;
    }
  },
);

/**
 * Bridges the `lit:thread-*` window events emitted by `ThreadWidget` into editor
 * actions. Mirrors `fireAnnotationPlugin`: re-reads the live view in `update()`
 * and tears down all listeners in `destroy()`.
 *
 * Only the follow-up handler is implemented in this phase; export and delete are
 * wired as listener shells that Phase 6 (`threadExport`) fills in.
 */
const threadEventsPlugin = ViewPlugin.fromClass(
  class {
    private followupHandler: (e: Event) => void;
    private exportHandler: (e: Event) => void;
    private deleteHandler: (e: Event) => void;

    constructor(private view: EditorView) {
      this.followupHandler = (e: Event) => {
        const detail = (e as CustomEvent<ThreadFollowupEventDetail>).detail;
        if (detail?.annotation && detail.question?.trim()) {
          threadFollowup({ view: this.view, annotation: detail.annotation, question: detail.question })
            .catch((err) => console.warn("threadFollowup failed:", err));
        }
      };
      this.exportHandler = (e: Event) => {
        const detail = (e as CustomEvent<ThreadExportEventDetail>).detail;
        if (detail?.annotation) {
          copyThreadExport(detail.annotation, detail.turn).catch((err) =>
            console.warn("thread export failed:", err),
          );
        }
      };
      this.deleteHandler = (e: Event) => {
        const detail = (e as CustomEvent<ThreadDeleteEventDetail>).detail;
        if (detail?.annotation) deleteThread(this.view, detail.annotation, detail.range);
      };
      window.addEventListener("lit:thread-followup", this.followupHandler);
      window.addEventListener("lit:thread-export", this.exportHandler);
      window.addEventListener("lit:thread-delete", this.deleteHandler);
    }
    update(update: ViewUpdate) {
      this.view = update.view;
    }
    destroy() {
      window.removeEventListener("lit:thread-followup", this.followupHandler);
      window.removeEventListener("lit:thread-export", this.exportHandler);
      window.removeEventListener("lit:thread-delete", this.deleteHandler);
    }
  },
);

const llmLockBridgePlugin = ViewPlugin.fromClass(
  class {
    private unsub: () => void;
    private destroyed = false;
    constructor(private view: EditorView) {
      const initial = useModalLockStore.getState().llmLocked;
      if (initial) {
        queueMicrotask(() => {
          if (this.destroyed) return;
          this.view.dispatch({ effects: setLlmLockedEffect.of(true) });
        });
      }
      this.unsub = useModalLockStore.subscribe((s) => {
        if (s.llmLocked !== this.view.state.field(llmLockedField)) {
          this.view.dispatch({ effects: setLlmLockedEffect.of(s.llmLocked) });
        }
      });
    }
    update(update: ViewUpdate) {
      this.view = update.view;
    }
    destroy() {
      this.destroyed = true;
      this.unsub();
    }
  },
);

export function annotationExtension(): Extension {
  return [
    displayModeField,
    annotationDataField,
    annotationPlugin,
    annotationDecorationPlugin,
    annotationBlockDecorationField,
    annotationFoldField,
    threadTurnField,
    firingAnnotationsField,
    firingRangeField,
    llmLockedField,
    llmLockBridgePlugin,
    scopeHighlightExtension(),
    markDecorationExtension(),
    keymap.of(escapeAnnotationKeymap),
    fireAnnotationPlugin,
    threadEventsPlugin,
  ];
}

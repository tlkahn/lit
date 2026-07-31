import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, type PluginValue, keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { listen } from "@tauri-apps/api/event";
import { parseAnnotations, listAnnotations, type Annotation } from "../../lib/ipc";
import { type AnnotationDisplayMode } from "../../stores/preferences";
import { isCursorOnLine } from "./proximity";
import { PillWidget, MarkerWidget, ThreadWidget, annotationFoldField, threadTurnField, setThreadTurnEffect, firingAnnotationsField, firingRangeField, llmLockedField, setLlmLockedEffect, setFiringAnnotation, clearFiringAnnotation, toggleAnnotationFoldEffect, setAllAnnotationFoldsEffect, isEffectiveFoldAllEffect } from "./annotationWidgets";
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
export function buildAnnotationFingerprint(annotations: Annotation[]): string {
  return annotations
    .map((a) => `${a.annotation_type}:${a.body ?? ""}`)
    .join("\n");
}

export type IndexedGroup = Array<{ uuid: string; char_start: number }>;

/** Group indexed annotations by (type, body) for fuzzy matching. */
export function buildIndexedGroups(indexed: Array<{ annotation_type: string; body: string | null; uuid: string; char_start: number }>): Map<string, IndexedGroup> {
  const groups = new Map<string, IndexedGroup>();
  for (const ia of indexed) {
    const key = `${ia.annotation_type}:${ia.body ?? ""}`;
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push({ uuid: ia.uuid, char_start: ia.char_start });
  }
  return groups;
}

/**
 * Enrich annotations with UUIDs using fuzzy (type+body) matching + proximity
 * tiebreaker. Authored (already-set) uuids are left alone. Chosen candidates
 * are consumed so two live anns cannot share one indexed uuid. The input
 * `groups` map is not mutated (cloned per call) so the plugin cache stays intact.
 */
export function enrichWithGroups(annotations: Annotation[], groups: Map<string, IndexedGroup>): void {
  // Clone group arrays so consumption does not empty the caller's cache.
  const working = new Map<string, IndexedGroup>();
  for (const [key, arr] of groups) working.set(key, arr.slice());

  for (const ann of annotations) {
    const key = `${ann.annotation_type}:${ann.body ?? ""}`;
    const candidates = working.get(key);
    if (ann.uuid != null && ann.uuid !== "") {
      // Authored uuid wins; still consume matching candidate so it cannot be re-handed.
      if (candidates) {
        const idx = candidates.findIndex((c) => c.uuid === ann.uuid);
        if (idx >= 0) candidates.splice(idx, 1);
      }
      continue;
    }
    if (!candidates || candidates.length === 0) continue;
    let bestIdx = 0;
    let bestDist = Math.abs(candidates[0]!.char_start - ann.char_start);
    for (let i = 1; i < candidates.length; i++) {
      const d = Math.abs(candidates[i]!.char_start - ann.char_start);
      if (d < bestDist) { bestIdx = i; bestDist = d; }
    }
    const [best] = candidates.splice(bestIdx, 1);
    ann.uuid = best!.uuid;
  }
}

/**
 * Second-pass identity: unmatched live annotations inherit uuid from the
 * previous annotationDataField snapshot when type matches. Pairing is
 * ordinal-by-char_start within each type (mirrors the indexer anti-swap
 * rule). Bridges the stale-index window after a body edit without inventing
 * uuids the index never had (#978).
 */
export function carryForwardUuids(live: Annotation[], prev: Annotation[]): void {
  if (prev.length === 0) return;

  type Slot = { ann: Annotation; char_start: number };
  const unmatchedLiveByType = new Map<string, Slot[]>();
  for (const ann of live) {
    if (ann.uuid != null && ann.uuid !== "") continue;
    let arr = unmatchedLiveByType.get(ann.annotation_type);
    if (!arr) { arr = []; unmatchedLiveByType.set(ann.annotation_type, arr); }
    arr.push({ ann, char_start: ann.char_start });
  }
  if (unmatchedLiveByType.size === 0) return;

  const prevByType = new Map<string, Slot[]>();
  for (const ann of prev) {
    if (ann.uuid == null || ann.uuid === "") continue;
    let arr = prevByType.get(ann.annotation_type);
    if (!arr) { arr = []; prevByType.set(ann.annotation_type, arr); }
    arr.push({ ann, char_start: ann.char_start });
  }

  for (const [type, liveSlots] of unmatchedLiveByType) {
    const prevSlots = prevByType.get(type);
    if (!prevSlots || prevSlots.length === 0) continue;
    liveSlots.sort((a, b) => a.char_start - b.char_start);
    prevSlots.sort((a, b) => a.char_start - b.char_start);
    const pairCount = Math.min(liveSlots.length, prevSlots.length);
    for (let i = 0; i < pairCount; i++) {
      liveSlots[i]!.ann.uuid = prevSlots[i]!.ann.uuid;
    }
  }
}

export const annotationPlugin = ViewPlugin.fromClass(
  class {
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private lastDocStr = "";
    private lastAnnotationFingerprint = "";
    private lastNodeId: string | null = null;
    private lastIndexedGroups: Map<string, IndexedGroup> = new Map();
    private unlistenGraphUpdated: (() => void) | null = null;
    private destroyed = false;

    constructor(private view: EditorView) {
      this.lastDocStr = view.state.doc.toString();
      this.bindGraphUpdated();
      this.fireIPC();
    }

    private bindGraphUpdated() {
      // #978 H2: save/reindex does not change the live fingerprint, so wipe
      // the cache and re-list immediately when the graph emits.
      listen("lit:graph-updated", () => {
        if (this.destroyed) return;
        this.lastAnnotationFingerprint = "";
        this.fireIPC();
      })
        .then((unlisten) => {
          if (this.destroyed) {
            unlisten();
            return;
          }
          this.unlistenGraphUpdated = unlisten;
        })
        .catch(() => { /* non-tauri / test envs */ });
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

        // Snapshot before enrich/dispatch so carry-forward and the empty-empty
        // guard both see the pre-update field value.
        const prev = this.view.state.field(annotationDataField);

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
            // #978: after body-key miss on a stale index, keep the uuid the
            // live plugin already committed this session (prev snapshot beats
            // index positional fallback which can steal orphan uuids).
            carryForwardUuids(annotations, prev);
          } catch { /* best-effort enrichment */ }
        }

        if (annotations.length === 0 && prev.length === 0) return;
        this.view.dispatch({ effects: setAnnotationData.of(annotations) });
        window.dispatchEvent(new CustomEvent("lit:annotations-changed"));
      } catch { /* IPC failure is non-fatal */ }
    }

    destroy() {
      this.destroyed = true;
      this.unlistenGraphUpdated?.();
      this.unlistenGraphUpdated = null;
      if (this.debounceTimer != null) clearTimeout(this.debounceTimer);
    }
  },
);

export function findAnnotationForRange(
  annotations: Annotation[],
  from: number,
  to: number,
): Annotation | undefined {
  return annotations.find(
    (a) => a.char_start === from && a.char_end === to,
  );
}

/**
 * Index annotations by their `char_start:char_end` span for O(1) range lookup.
 *
 * Replaces repeated O(n) `findAnnotationForRange` scans inside a per-node tree
 * walk (which is O(n*m) overall) with a single O(n) build plus O(1) lookups. To
 * preserve `findAnnotationForRange`'s "first match wins" semantics, a span that
 * appears more than once keeps the earliest annotation.
 */
export function buildAnnotationRangeMap(annotations: Annotation[]): Map<string, Annotation> {
  const map = new Map<string, Annotation>();
  for (const a of annotations) {
    const key = `${a.char_start}:${a.char_end}`;
    if (!map.has(key)) map.set(key, a);
  }
  return map;
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
  const rangeMap = buildAnnotationRangeMap(annotations);

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

        const ann = rangeMap.get(`${nodeFrom}:${nodeTo}`);
        if (!ann) return;

        // Reuse already-computed line numbers for the multiline check.
        const isMultiLine = startLine !== endLine;

        // A multiline block annotation's widget is a line-break-spanning
        // replacement, which CodeMirror forbids from plugin sources;
        // splitAnnotationDecorations would route it to the discarded "block"
        // subset. annotationBlockDecorationField (a StateField) is the sole
        // producer of that widget, so skip building it here - the line
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
 * single-line replacements) and the line-break-spanning subset (multiline
 * block widgets).
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
    } else if (update.transactions.some((tr) => hasInlineAnnotationEffect(tr))) {
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

function isSharedAnnotationEffect(e: StateEffect<unknown>): boolean {
  return (
    e.is(setAnnotationData) ||
    e.is(setFiringAnnotation) ||
    e.is(clearFiringAnnotation) ||
    e.is(setLlmLockedEffect)
  );
}

/**
 * Inline-plugin gate: returns true only for effects that affect inline
 * annotation rendering. Excludes fold and thread-turn effects (block-only).
 */
export function hasInlineAnnotationEffect(tr: { effects: readonly StateEffect<unknown>[] }): boolean {
  return tr.effects.some((e) =>
    isSharedAnnotationEffect(e) || e.is(setDisplayMode),
  );
}

/**
 * Block-field gate: returns true for effects that affect block annotation
 * rendering. Excludes setDisplayMode (buildAnnotationBlockDecorations never
 * reads displayModeField). The field's own `update` uses `isSharedAnnotationEffect`
 * and `isFoldOrTurnOnly` directly; this predicate is the public block-relevant
 * test used by `hasAnnotationEffect`.
 */
export function hasBlockAnnotationEffect(tr: { effects: readonly StateEffect<unknown>[] }): boolean {
  return tr.effects.some((e) =>
    isSharedAnnotationEffect(e) ||
    e.is(toggleAnnotationFoldEffect) ||
    isEffectiveFoldAllEffect(e) ||
    e.is(setThreadTurnEffect),
  );
}

/**
 * Superset gate: returns true when a transaction carries any
 * annotation-relevant state effect (inline OR block-only).
 */
export function hasAnnotationEffect(tr: { effects: readonly StateEffect<unknown>[] }): boolean {
  return hasInlineAnnotationEffect(tr) || hasBlockAnnotationEffect(tr);
}

/**
 * Builds ONLY the line-break-spanning annotation decorations (multiline block
 * pills and thread widgets) over the full document. These cannot be delivered
 * via the `annotationDecorationPlugin` (CodeMirror forbids line-break-spanning
 * replacements from plugins), so they live in this StateField instead.
 *
 * Mirrors `buildAnnotationDecorations` but is viewport-independent (block
 * annotations are few and the field has no access to view geometry).
 *
 * `blockSensitiveLines` tracks only tree-witnessed annotation lines (witness
 * before line-tracking). Unmatched tree nodes intentionally do not mark lines
 * (no decoration can exist there, so no rebuild is ever needed).
 */
/** State shape for `annotationBlockDecorationField`. */
export interface BlockDecorationState {
  /** The DecorationSet containing line-break-spanning block annotation widgets. */
  decorations: DecorationSet;
  /**
   * Document line numbers spanned by multiline block annotations. Used by the
   * field's selection guard to skip rebuilds when the cursor moves between
   * lines that no block annotation touches.
   */
  blockSensitiveLines: Set<number>;
}

function blockWidgetFor(
  ann: Annotation,
  pos: number,
  foldState: Map<number, boolean> | undefined,
  turnState: Map<number, number> | undefined,
  firingSet: Set<number>,
  llmLocked: boolean,
): PillWidget | ThreadWidget {
  const isFiring = firingSet.has(pos);
  if (ann.annotation_type === "thread") {
    const isCollapsed = foldState?.get(pos) ?? false;
    return new ThreadWidget(ann, turnState?.get(pos) ?? 0, isCollapsed, pos, isFiring);
  }
  // Non-thread blocks render as pills — fold state is thread-only and ignored.
  return new PillWidget(ann, isFiring, llmLocked);
}

export function buildAnnotationBlockDecorations(state: EditorView["state"]): BlockDecorationState {
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
  const tree = syntaxTree(state);
  const rangeMap = buildAnnotationRangeMap(annotations);

  for (const ann of rangeMap.values()) {
    const from = ann.char_start;
    const to = ann.char_end;
    if (from < 0 || to > docLen || from >= to) continue;

    const startLine = state.doc.lineAt(from);
    const endLine = state.doc.lineAt(to);
    if (startLine.number === endLine.number) continue;
    if (startLine.from !== from) continue;

    let isBlock = false;
    tree.iterate({
      from,
      to: from + 1,
      enter: (node) => {
        if (node.name === "BlockAnnotation" && node.from === from && node.to === to) {
          isBlock = true;
        }
      },
    });
    if (!isBlock) continue;

    // Line tracking after witness: only tree-witnessed annotations mark lines
    // cursor-sensitive. Unmatched tree nodes intentionally do not mark lines
    // (no decoration can exist there, so no rebuild is ever needed).
    for (let l = startLine.number; l <= endLine.number; l++) blockSensitiveLines.add(l);

    if (isCursorOnLine(state, from, to)) continue;

    const widget = blockWidgetFor(ann, from, foldState, turnState, firingSet, llmLocked);
    decos.push({ from, to, deco: Decoration.replace({ widget }) });
  }

  decos.sort((a, b) => a.from - b.from || a.to - b.to);
  return {
    decorations: Decoration.set(decos.map((d) => d.deco.range(d.from, d.to))),
    blockSensitiveLines,
  };
}

/**
 * Returns true when a transaction carries ONLY fold/turn effects (no doc
 * change, no shared annotation effects). The field's `update` uses this to
 * enter the surgical path, which replaces existing block decorations in-place
 * without a full rebuild. The caller additionally disqualifies the surgical
 * path when the transaction carries a selection change or a tree-identity
 * change (e.g. a compartment reconfigure that swaps the grammar), forcing a
 * full rebuild in those cases.
 */
function isFoldOrTurnOnly(tr: { effects: readonly StateEffect<unknown>[]; docChanged: boolean }): boolean {
  if (tr.docChanged) return false;
  let hasFoldOrTurn = false;
  for (const e of tr.effects) {
    if (e.is(toggleAnnotationFoldEffect) || isEffectiveFoldAllEffect(e) || e.is(setThreadTurnEffect)) {
      hasFoldOrTurn = true;
    } else if (isSharedAnnotationEffect(e)) {
      return false;
    }
  }
  return hasFoldOrTurn;
}

/**
 * Replaces existing block decorations at fold/turn-affected positions. Never
 * invents new ranges - discovery of block-eligible positions is exclusively
 * the full builder's job. Does not recompute `blockSensitiveLines` since
 * fold/turn cannot change span membership.
 */
function surgicallyUpdateBlockDecorations(
  prev: BlockDecorationState,
  state: EditorView["state"],
  effects: readonly StateEffect<unknown>[],
): BlockDecorationState {
  const affected = new Set<number>();
  for (const e of effects) {
    if (e.is(toggleAnnotationFoldEffect)) affected.add(e.value.pos);
    if (e.is(setAllAnnotationFoldsEffect)) {
      for (const pos of e.value.positions) affected.add(pos);
    }
    if (e.is(setThreadTurnEffect)) affected.add(e.value.pos);
  }

  const existingSpans = new Map<number, number>();
  const iter = prev.decorations.iter();
  while (iter.value) {
    if (affected.has(iter.from)) existingSpans.set(iter.from, iter.to);
    iter.next();
  }

  const annotations = state.field(annotationDataField);
  const rangeMap = buildAnnotationRangeMap(annotations);

  const firingSet = state.field(firingAnnotationsField, false) ?? new Set<number>();
  const llmLocked = state.field(llmLockedField, false) ?? false;
  const foldState = state.field(annotationFoldField, false);
  const turnState = state.field(threadTurnField, false);

  const newDecos: Array<{ from: number; to: number; deco: Decoration }> = [];

  for (const pos of affected) {
    const span = existingSpans.get(pos);
    if (span === undefined) continue;

    const ann = rangeMap.get(`${pos}:${span}`);
    if (!ann) continue;

    if (isCursorOnLine(state, pos, span)) continue;

    const widget = blockWidgetFor(ann, pos, foldState, turnState, firingSet, llmLocked);
    newDecos.push({ from: pos, to: span, deco: Decoration.replace({ widget }) });
  }

  newDecos.sort((a, b) => a.from - b.from || a.to - b.to);

  const updated = prev.decorations.update({
    filter: (from) => !affected.has(from),
    add: newDecos.map((d) => d.deco.range(d.from, d.to)),
  });

  return { decorations: updated, blockSensitiveLines: prev.blockSensitiveLines };
}

/**
 * Returns true when a tree-identity change (parser progress) warrants
 * rebuilding block decorations. When there are no annotations, or the
 * materialized tree on `startState` already covered all annotation positions,
 * the parser is extending into territory with no block annotations - skip.
 *
 * Uses `syntaxTree(startState).length` (the materialized StateField tree)
 * rather than `syntaxTreeAvailable` (which queries the live parse context and
 * may reflect progress not yet committed to the StateField).
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
 * Delivers line-break-spanning annotation widgets (pills, threads) via a
 * `StateField` (not the plugin) because CodeMirror only permits such
 * replacements from field/facet sources. Recomputes on doc change and
 * annotation effects via an annotation-driven builder with bounded
 * per-annotation `tree.iterate` calls. Fold/turn-only transactions take a
 * surgical path that replaces only affected positions (unless the transaction
 * also carries a selection change, which forces a full rebuild). For
 * selection-only transactions it applies a cursor-sensitivity guard: the
 * rebuild is skipped unless the old or new cursor line spans a block
 * annotation, so plain cursor moves cost nothing.
 *
 * Value shape: `BlockDecorationState` - `.decorations` for the DecorationSet,
 * `.blockSensitiveLines` for the cursor guard set.
 */
export const annotationBlockDecorationField = StateField.define<BlockDecorationState>({
  create(state) {
    return buildAnnotationBlockDecorations(state);
  },
  update(value, tr) {
    if (tr.docChanged || tr.effects.some((e) => isSharedAnnotationEffect(e))) {
      return buildAnnotationBlockDecorations(tr.state);
    }
    if (isFoldOrTurnOnly(tr)) {
      if (tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
        return buildAnnotationBlockDecorations(tr.state);
      }
      return surgicallyUpdateBlockDecorations(value, tr.state, tr.effects);
    }
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

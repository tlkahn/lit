import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type ViewUpdate, keymap } from "@codemirror/view";
import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";
import { parseAnnotations, annotationFindUuid, listAnnotations, type Annotation } from "../../lib/ipc";
import { type AnnotationDisplayMode } from "../../stores/preferences";
import { isCursorOnLine } from "./proximity";
import { PillWidget, MarkerWidget, CalloutWidget, annotationFoldField, firingAnnotationsField, llmLockedField, setLlmLockedEffect, annotationThreadKeysField, setAnnotationThreadKeys } from "./annotationWidgets";
import { setsEqual } from "../../lib/headingTree";
import type { ConversationRow } from "../../lib/ipc";
import { useModalLockStore } from "../../stores/modalLock";
import { useWorkspaceStore } from "../../stores/workspace";
import { useConversationStore } from "../../stores/conversation";
import { useBottomPanelStore } from "../../stores/bottomPanel";
import { scopeHighlightExtension } from "./scopeHighlight";
import { escapeAnnotationKeymap } from "./escapeAnnotation";
import { fireAnnotation } from "../../lib/fireOrchestrator";
import { insertCompanionAnnotation, insertCompanionAtCursor } from "../../lib/companionInsert";

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

export const annotationDecorationProvider = EditorView.decorations.compute(
  [annotationDataField, annotationFoldField, firingAnnotationsField, displayModeField, llmLockedField, annotationThreadKeysField, "selection"],
  (state) => {
    const annotations = state.field(annotationDataField);
    if (annotations.length === 0) return Decoration.none;
    const mode = state.field(displayModeField);
    const firingSet = state.field(firingAnnotationsField, false) ?? new Set<number>();
    const llmLocked = state.field(llmLockedField, false) ?? false;
    const threadKeys = state.field(annotationThreadKeysField, false) ?? new Set<string>();

    const docLen = state.doc.length;
    const decos: { from: number; to: number; deco: Decoration }[] = [];

    const tree = ensureSyntaxTree(state, docLen, 200) ?? syntaxTree(state);
    tree.iterate({
      enter: (node) => {
        if (node.name !== "InlineAnnotation" && node.name !== "BlockAnnotation") return;

        const from = node.from;
        const to = node.to;
        if (from < 0 || to > docLen || from >= to) return;
        if (isCursorOnLine(state, from, to)) return;

        const ann = findAnnotationForRange(annotations, from, to);
        if (!ann) return;

        const text = state.doc.sliceString(from, to);
        const isMultiLine = text.includes("\n");
        const isFiring = firingSet.has(from);

        const hasThread = !!ann.uuid && threadKeys.has(ann.uuid);

        if (node.name === "BlockAnnotation" && isMultiLine) {
          const foldState = state.field(annotationFoldField, false);
          const isCollapsed = foldState?.get(from) ?? false;
          decos.push({
            from,
            to,
            deco: Decoration.replace({
              widget: new CalloutWidget(ann, isCollapsed, from, isFiring, llmLocked, hasThread),
            }),
          });
        } else {
          const widget = mode === "footnote" ? new MarkerWidget(ann, isFiring, llmLocked, hasThread) : new PillWidget(ann, isFiring, llmLocked, hasThread);
          decos.push({
            from,
            to,
            deco: Decoration.replace({ widget }),
          });
        }
      },
    });

    decos.sort((a, b) => a.from - b.from || a.to - b.to);
    return Decoration.set(decos.map((d) => d.deco.range(d.from, d.to)));
  },
);

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

const companionInsertPlugin = ViewPlugin.fromClass(
  class {
    private handler: (e: Event) => void;
    constructor(private view: EditorView) {
      this.handler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.responseText) {
          if (detail.sourceAnnotation) {
            insertCompanionAnnotation(this.view, detail.sourceAnnotation, detail.responseText);
          } else {
            insertCompanionAtCursor(this.view, detail.responseText);
          }
        }
      };
      window.addEventListener("lit:insert-companion-annotation", this.handler);
    }
    update(update: ViewUpdate) {
      this.view = update.view;
    }
    destroy() {
      window.removeEventListener("lit:insert-companion-annotation", this.handler);
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

const openAnnotationThreadPlugin = ViewPlugin.fromClass(
  class {
    private handler: (e: Event) => void;
    constructor(_view: EditorView) {
      this.handler = async (e: Event) => {
        const annotation = (e as CustomEvent).detail?.annotation as Annotation | undefined;
        if (!annotation) return;

        const nodeId = useWorkspaceStore.getState().currentPagePath;
        if (!nodeId) return;

        const uuid = annotation.uuid
          ?? await annotationFindUuid(nodeId, annotation.annotation_type, annotation.body, annotation.char_start);
        if (!uuid) return;

        const title = annotation.body
          ? `${annotation.annotation_type}: ${annotation.body}`
          : annotation.annotation_type;

        await useConversationStore.getState().findOrCreateAnnotationThread(nodeId, uuid, title);
        useBottomPanelStore.getState().handleTabClick("llm-response");
      };
      window.addEventListener("lit:open-annotation-thread", this.handler);
    }
    update(_update: ViewUpdate) {
      // view not used by this plugin's handler
    }
    destroy() {
      window.removeEventListener("lit:open-annotation-thread", this.handler);
    }
  },
);

export function deriveThreadKeys(conversations: ConversationRow[]): Set<string> {
  return new Set(
    conversations
      .filter(c => c.anchor_type === "annotation" && c.anchor_key != null)
      .map(c => c.anchor_key!),
  );
}

const conversationThreadBridgePlugin = ViewPlugin.fromClass(
  class {
    private unsub: () => void;
    private lastKeys: Set<string>;
    private destroyed = false;

    constructor(private view: EditorView) {
      const initial = deriveThreadKeys(useConversationStore.getState().conversations);
      this.lastKeys = initial;
      if (initial.size > 0) {
        queueMicrotask(() => {
          if (this.destroyed) return;
          this.view.dispatch({ effects: setAnnotationThreadKeys.of(initial) });
        });
      }
      this.unsub = useConversationStore.subscribe((s) => {
        const next = deriveThreadKeys(s.conversations);
        if (!setsEqual(this.lastKeys, next)) {
          this.lastKeys = next;
          this.view.dispatch({ effects: setAnnotationThreadKeys.of(next) });
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
    annotationDecorationProvider,
    annotationFoldField,
    firingAnnotationsField,
    llmLockedField,
    llmLockBridgePlugin,
    annotationThreadKeysField,
    scopeHighlightExtension(),
    keymap.of(escapeAnnotationKeymap),
    fireAnnotationPlugin,
    companionInsertPlugin,
    openAnnotationThreadPlugin,
    conversationThreadBridgePlugin,
  ];
}

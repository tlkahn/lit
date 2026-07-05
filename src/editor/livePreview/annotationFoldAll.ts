import type { EditorView } from "@codemirror/view";
import { annotationDataField } from "./annotationState";
import { annotationFoldField, setAllAnnotationFoldsEffect } from "./annotationWidgets";
import { isPerfEnabled } from "./perf";

/**
 * Collapses every multiline block annotation (callout/thread) in `view`, or
 * expands them all when every one is already collapsed. Single-line pill
 * annotations are unaffected. Returns false (without dispatching) when the
 * document has no multiline block annotations.
 *
 * Targets are derived from `annotationDataField` — populated by the Rust
 * backend parsing the *full* document text (`parseAnnotations(doc.toString())`)
 * — so coverage is complete regardless of how far CM6's background parser has
 * gotten, and collection is O(annotations) with zero parser involvement.
 * (The previous syntax-tree walk paid an `ensureSyntaxTree` budget on large
 * docs and silently skipped every annotation past the parse frontier.)
 *
 * Which annotations qualify:
 * - Multiline ⇒ block: the inline annotation parser aborts on any newline, so
 *   an annotation whose range spans more than one line can only be a
 *   BlockAnnotation. (`form === "block"` is NOT a multiline test — it only
 *   reflects the presence of a `---` separator in the DSL — so we filter by
 *   line span, exactly like the render path does.)
 * - Line-start parity guard: the Lezer block parser requires the opener at
 *   line start (/^<!---/), so a multiline `<!---...--->` found mid-line renders
 *   no node and no callout. Requiring `lineAt(from).from === from` keeps such
 *   phantoms out of the fold map.
 *
 * Stale positions (doc edited within the reparse debounce) may land fold-map
 * entries at unrendered offsets — harmless: fold state simply applies once a
 * widget renders there. Positions past the parse frontier behave the same way,
 * taking effect as the background parser materializes their widgets.
 */
export function toggleAllBlockAnnotationFolds(view: EditorView): boolean {
  const { state } = view;
  const annotations = state.field(annotationDataField, false) ?? [];
  if (annotations.length === 0) return false;

  const collectStart = isPerfEnabled() ? performance.now() : 0;
  const docLen = state.doc.length;
  const targets: number[] = [];
  for (const ann of annotations) {
    const from = ann.char_start;
    const to = ann.char_end;
    if (from < 0 || to > docLen || from >= to) continue;
    const startLine = state.doc.lineAt(from);
    // Rendered callouts always start at a line beginning (the Lezer block
    // parser requires /^<!---/); mid-line multiline annotations produce no
    // node/callout.
    if (startLine.from !== from) continue;
    // Single-line blocks render as pills — no fold state (same check the
    // render path uses; `form` is NOT a multiline indicator, see is_block_form).
    if (startLine.number === state.doc.lineAt(to).number) continue;
    targets.push(from);
  }
  if (targets.length === 0) return false;

  const foldMap = state.field(annotationFoldField, false);
  const allCollapsed = targets.every((pos) => foldMap?.get(pos) ?? false);
  const dispatchStart = isPerfEnabled() ? performance.now() : 0;
  view.dispatch({
    effects: setAllAnnotationFoldsEffect.of({ positions: targets, collapsed: !allCollapsed }),
  });
  if (isPerfEnabled()) {
    const end = performance.now();
    console.log(
      `[perf] foldAll ${allCollapsed ? "expand" : "collapse"} n=${targets.length} | ` +
        `collect=${(dispatchStart - collectStart).toFixed(1)}ms ` +
        `dispatch=${(end - dispatchStart).toFixed(1)}ms total=${(end - collectStart).toFixed(1)}ms`,
    );
  }
  return true;
}

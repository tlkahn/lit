import { Prec, EditorSelection, type Extension, type EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Opening pair character -> closing character. Typing one of these opening
 * characters while text is selected wraps the selection (VSCode/Sublime
 * behavior) rather than replacing it.
 */
export const PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "`": "`",
};

/**
 * Build a transaction that wraps every non-empty selection range in the pair
 * for `insert`, keeping the selection on the inner text (so the user can
 * immediately double-wrap). Returns `null` when the input should be handled
 * normally: `insert` is not an opening pair char, the whole selection is empty,
 * or the state is read-only.
 */
export function applyPairWrap(state: EditorState, insert: string): TransactionSpec | null {
  const close = PAIRS[insert];
  if (close === undefined) return null;
  if (state.selection.main.empty) return null;
  if (state.readOnly) return null;

  return state.changeByRange((range) => {
    // Multi-cursor can mix empty and non-empty ranges; empty ones just insert.
    if (range.empty) {
      return {
        changes: { from: range.from, insert },
        range: EditorSelection.cursor(range.from + insert.length),
      };
    }
    return {
      changes: [
        { from: range.from, insert },
        { from: range.to, insert: close },
      ],
      // Both anchor and head sit within [from, to], so inserting the opening
      // char at `from` shifts each by one and keeps the selection direction.
      range: EditorSelection.range(range.anchor + insert.length, range.head + insert.length),
    };
  });
}

/**
 * CM6 extension: wrap selected text in matching pairs on input. Wrapped in
 * `Prec.high` so it runs before the code editor's `closeBrackets()` handler;
 * when nothing is selected it returns `false` and `closeBrackets` / the default
 * insertion take over.
 */
export function pairWrapExtension(): Extension {
  return Prec.high(
    EditorView.inputHandler.of((view, _from, _to, insert) => {
      const spec = applyPairWrap(view.state, insert);
      if (!spec) return false;
      view.dispatch({ ...spec, userEvent: "input.type" });
      return true;
    }),
  );
}

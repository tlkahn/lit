/**
 * Thread export & delete actions.
 *
 * Pure markdown builders turn a thread annotation's wire-format body into clean
 * markdown source for the clipboard: each turn becomes a `## Q: <question>`
 * heading followed by its response. A no-question turn (the leading no-prefix
 * response case from `parseThreadBody`) emits just the response, with no heading.
 *
 * `copyThreadExport` is the single entry point the editor plugin delegates to: it
 * branches on `turn === -1` (whole thread) vs a single-turn index, copies via the
 * Clipboard API, and surfaces a toast through `useStatusMessageStore`.
 *
 * `deleteThread` removes the annotation in place via a CM6 changes transaction.
 */

import type { Annotation } from "./ipc";
import type { EditorView } from "@codemirror/view";
import { parseThreadBody, type ThreadTurn } from "./threadBody";
import { useStatusMessageStore } from "../stores/statusMessage";

/** Format a single parsed turn as markdown: heading + response, or bare response. */
function formatTurn(turn: ThreadTurn): string {
  if (turn.question === "") return turn.response;
  if (turn.response === "") return `## Q: ${turn.question}`;
  return `## Q: ${turn.question}\n\n${turn.response}`;
}

/** Render an entire thread annotation as markdown source. Returns "" if empty. */
export function exportThreadToMarkdown(annotation: Annotation): string {
  const turns = parseThreadBody(annotation.body ?? "");
  if (turns.length === 0) return "";
  return turns.map(formatTurn).join("\n\n");
}

/** Render a single turn as markdown source. Returns "" if the index is out of range. */
export function exportTurnToMarkdown(annotation: Annotation, turnIndex: number): string {
  const turns = parseThreadBody(annotation.body ?? "");
  const turn = turns[turnIndex];
  if (turn === undefined) return "";
  return formatTurn(turn);
}

/**
 * Copy a thread (whole thread when `turn === -1`, otherwise the single turn at
 * `turn`) to the clipboard and surface a toast. An empty/no-content export is a
 * no-op aside from an error toast — we never write an empty string.
 */
export async function copyThreadExport(annotation: Annotation, turn: number): Promise<void> {
  const markdown =
    turn === -1 ? exportThreadToMarkdown(annotation) : exportTurnToMarkdown(annotation, turn);
  const { show } = useStatusMessageStore.getState();

  if (markdown === "") {
    show("Nothing to export", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(markdown);
    show("Copied to clipboard", "success");
  } catch {
    show("Copy failed", "error");
  }
}

/**
 * Delete a thread annotation by removing its `char_start..char_end` span from the
 * document. Wrapped in try/catch in case the view has been destroyed.
 */
export function deleteThread(view: EditorView, annotation: Annotation): void {
  try {
    view.dispatch({
      changes: { from: annotation.char_start, to: annotation.char_end, insert: "" },
    });
  } catch {
    /* view destroyed */
  }
}

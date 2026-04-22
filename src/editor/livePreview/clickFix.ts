import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export function createWrappedLineClickFix(): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return false;
      }

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const posCoords = view.coordsAtPos(pos);
      if (!posCoords || event.clientY >= posCoords.top) return false;

      // Click resolved to a position below where the user actually clicked.
      // This happens when replace decorations change line wrapping, causing
      // the last visual line of a wrapped paragraph to mismap to the next line.

      const line = view.state.doc.lineAt(pos);
      if (line.number <= 1) return false;

      const prevLine = view.state.doc.line(line.number - 1);
      const prevEndCoords = view.coordsAtPos(prevLine.to);
      if (!prevEndCoords || event.clientY > prevEndCoords.bottom) return false;

      const correctedPos = findClosestPos(
        view, prevLine.from, prevLine.to,
        event.clientX, event.clientY,
      );

      event.preventDefault();
      view.dispatch({ selection: { anchor: correctedPos }, scrollIntoView: true });
      view.focus();
      return true;
    },
  });
}

function findClosestPos(
  view: EditorView,
  from: number,
  to: number,
  targetX: number,
  targetY: number,
): number {
  let bestPos = to;
  let bestDist = Infinity;
  let foundTargetLine = false;

  for (let pos = to; pos >= from; pos--) {
    const coords = view.coordsAtPos(pos);
    if (!coords) continue;

    if (targetY >= coords.top && targetY <= coords.bottom) {
      foundTargetLine = true;
      const dist = Math.abs(coords.left - targetX);
      if (dist < bestDist) {
        bestDist = dist;
        bestPos = pos;
      }
    } else if (foundTargetLine) {
      break;
    }
  }

  return bestPos;
}

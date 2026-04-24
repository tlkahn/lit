import { Annotation, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate, type Command } from "@codemirror/view";
import { globalJumpTracker } from "./jumpTracker";
import { useWorkspaceStore } from "../stores/workspace";

export { globalJumpTracker } from "./jumpTracker";

export const docReplaced = Annotation.define<boolean>();
export const isJumpNavigation = Annotation.define<boolean>();

const jumpPlugin = ViewPlugin.define((view) => {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  return {
    prevLine: line.number,
    prevCol: pos - line.from,
    docJustReplaced: false,

    update(update: ViewUpdate) {
      if (update.transactions.some((t) => t.annotation(docReplaced))) {
        this.docJustReplaced = true;
        const p = update.state.selection.main.head;
        const l = update.state.doc.lineAt(p);
        this.prevLine = l.number;
        this.prevCol = p - l.from;
        return;
      }

      if (this.docJustReplaced && update.selectionSet) {
        this.docJustReplaced = false;
        const p = update.state.selection.main.head;
        const l = update.state.doc.lineAt(p);
        this.prevLine = l.number;
        this.prevCol = p - l.from;
        return;
      }

      if (globalJumpTracker.isNavigating) return;

      if (update.transactions.some((t) => t.annotation(isJumpNavigation))) {
        const p = update.state.selection.main.head;
        const l = update.state.doc.lineAt(p);
        this.prevLine = l.number;
        this.prevCol = p - l.from;
        return;
      }

      if (update.selectionSet && !update.docChanged) {
        const notePath = useWorkspaceStore.getState().currentPagePath ?? "";
        const pos = update.state.selection.main.head;
        const line = update.state.doc.lineAt(pos);
        const curLine = line.number;
        const curCol = pos - line.from;

        globalJumpTracker.recordJump(
          { notePath, line: this.prevLine, col: this.prevCol },
          { notePath, line: curLine, col: curCol },
        );

        this.prevLine = curLine;
        this.prevCol = curCol;
      } else if (update.docChanged) {
        const p = update.state.selection.main.head;
        const l = update.state.doc.lineAt(p);
        this.prevLine = l.number;
        this.prevCol = p - l.from;
      }
    },
  };
});

export function jumpHistoryExtension(): Extension {
  return [jumpPlugin];
}

export const navigateBack: Command = (view: EditorView) => {
  const store = useWorkspaceStore.getState();
  const notePath = store.currentPagePath ?? "";
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const current = { notePath, line: line.number, col: pos - line.from };

  const target = globalJumpTracker.navigateBack(current);
  if (!target) return false;

  if (target.notePath === notePath) {
    const targetLine = Math.min(target.line, view.state.doc.lines);
    const lineObj = view.state.doc.line(targetLine);
    const targetPos = lineObj.from + Math.min(target.col, lineObj.length);
    view.dispatch({
      selection: { anchor: targetPos },
      effects: EditorView.scrollIntoView(targetPos),
      annotations: isJumpNavigation.of(true),
    });
  } else {
    globalJumpTracker.isNavigating = true;
    store.selectPageAtLine(target.notePath, target.line);
  }

  return true;
};

export const navigateForward: Command = (view: EditorView) => {
  const target = globalJumpTracker.navigateForward();
  if (!target) return false;

  const store = useWorkspaceStore.getState();
  const notePath = store.currentPagePath ?? "";

  if (target.notePath === notePath) {
    const targetLine = Math.min(target.line, view.state.doc.lines);
    const lineObj = view.state.doc.line(targetLine);
    const targetPos = lineObj.from + Math.min(target.col, lineObj.length);
    view.dispatch({
      selection: { anchor: targetPos },
      effects: EditorView.scrollIntoView(targetPos),
      annotations: isJumpNavigation.of(true),
    });
  } else {
    globalJumpTracker.isNavigating = true;
    store.selectPageAtLine(target.notePath, target.line);
  }

  return true;
};

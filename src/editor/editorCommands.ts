import type { EditorView } from "@codemirror/view";
import type { Command } from "@codemirror/view";

function toggleWrapper(view: EditorView, marker: string): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);

  const len = marker.length;
  if (
    selected.length >= len * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    view.dispatch({
      changes: { from, to, insert: selected.slice(len, -len) },
      selection: { anchor: from, head: from + selected.length - len * 2 },
    });
    return true;
  }

  if (
    from >= len &&
    to + len <= state.doc.length &&
    state.sliceDoc(from - len, from) === marker &&
    state.sliceDoc(to, to + len) === marker
  ) {
    view.dispatch({
      changes: [
        { from: from - len, to: from, insert: "" },
        { from: to, to: to + len, insert: "" },
      ],
      selection: { anchor: from - len, head: to - len },
    });
    return true;
  }

  view.dispatch({
    changes: { from, to, insert: marker + selected + marker },
    selection: { anchor: from + len, head: from + len + selected.length },
  });
  return true;
}

export const toggleBold: Command = (view) => toggleWrapper(view, "**");

export const toggleItalic: Command = (view) => toggleWrapper(view, "*");

export const insertLink: Command = (view) => {
  const { state } = view;
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);

  if (selected) {
    const insert = `[${selected}](url)`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + selected.length + 3, head: from + selected.length + 6 },
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: "[](url)" },
      selection: { anchor: from + 1 },
    });
  }
  return true;
};

export const toggleComment: Command = (view) => {
  const { state } = view;
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);
  const marker = "%%";
  const len = marker.length;

  if (
    selected.length >= len * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(len, -len);
    view.dispatch({
      changes: { from, to, insert: inner },
      selection: { anchor: from, head: from + inner.length },
    });
    return true;
  }

  if (
    from >= len &&
    to + len <= state.doc.length &&
    state.sliceDoc(from - len, from) === marker &&
    state.sliceDoc(to, to + len) === marker
  ) {
    view.dispatch({
      changes: [
        { from: from - len, to: from, insert: "" },
        { from: to, to: to + len, insert: "" },
      ],
      selection: { anchor: from - len, head: to - len },
    });
    return true;
  }

  view.dispatch({
    changes: { from, to, insert: marker + selected + marker },
    selection: { anchor: from + len, head: from + len + selected.length },
  });
  return true;
};

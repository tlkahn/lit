export interface ViewState {
  scrollTop: number;
  cursor: number;
  mindmapFoldedIds?: string[];
}

export const DEFAULT_VIEW_STATE: ViewState = { scrollTop: 0, cursor: 0 };

export interface EditorContext {
  selectionText: string;
  selectionFrom: number;
  selectionTo: number;
  filePath: string;
}

export const DEFAULT_EDITOR_CONTEXT: EditorContext = {
  selectionText: "",
  selectionFrom: 0,
  selectionTo: 0,
  filePath: "",
};

export interface ViewState {
  scrollTop: number;
  cursor: number;
  mindmapFoldedIds?: string[];
}

export const DEFAULT_VIEW_STATE: ViewState = { scrollTop: 0, cursor: 0 };

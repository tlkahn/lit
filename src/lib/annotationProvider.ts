import {
  searchAnnotations,
  type AnnotationType,
  type AnnotationSearchResult,
} from "./ipc";
import {
  TYPE_ICON,
  certaintyMark,
  truncateBody,
} from "../editor/livePreview/annotationConstants";
import { useWorkspaceStore } from "../stores/workspace";
import { globalJumpTracker } from "../editor/jumpTracker";
import type { PaletteProvider, PaletteResult, PaletteFilterOption } from "./paletteRegistry";

const ANNOTATION_FILTER_OPTIONS: PaletteFilterOption[] = [
  { id: "all", label: "All" },
  { id: "note", label: "note", icon: TYPE_ICON.note },
  { id: "question", label: "question", icon: TYPE_ICON.question },
  { id: "todo", label: "todo", icon: TYPE_ICON.todo },
  { id: "crossref", label: "crossref", icon: TYPE_ICON.crossref },
  { id: "apparatus", label: "apparatus", icon: TYPE_ICON.apparatus },
  { id: "translation", label: "translation", icon: TYPE_ICON.translation },
];

function mapResult(r: AnnotationSearchResult): PaletteResult {
  const cert = certaintyMark(r.certainty);
  return {
    id: `annotation-${r.annotation_id}`,
    title: r.node_title,
    subtitle: truncateBody(r.body),
    icon: TYPE_ICON[r.annotation_type],
    section: "Annotations",
    data: {
      annotation_id: r.annotation_id,
      node_id: r.node_id,
      source_line: r.source_line,
      annotation_type: r.annotation_type,
      certainty: r.certainty,
      certaintyMark: cert,
      body: r.body,
      date: r.date,
      char_start: r.char_start,
      char_end: r.char_end,
    },
  };
}

export const annotationProvider: PaletteProvider = {
  id: "annotations",
  prefix: "@",
  label: "Annotations",
  priority: 20,
  filterOptions: ANNOTATION_FILTER_OPTIONS,

  async search(query: string, filter?: string): Promise<PaletteResult[]> {
    if (!query) return [];
    const annotationType = filter && filter !== "all" ? (filter as AnnotationType) : undefined;
    const results = await searchAnnotations(query, annotationType);
    return results.map(mapResult);
  },

  onSelect(result: PaletteResult): void {
    const d = result.data as {
      node_id: string;
      source_line: number;
    };
    const state = useWorkspaceStore.getState();
    const currentPagePath = state.currentPagePath;

    globalJumpTracker.recordJump(
      { notePath: currentPagePath ?? "", line: 1, col: 0 },
      { notePath: d.node_id, line: d.source_line, col: 0 },
    );

    if (d.node_id === currentPagePath) {
      window.dispatchEvent(
        new CustomEvent("lit:scroll-to-line", {
          detail: { line: d.source_line, cursor: true },
        }),
      );
    } else {
      state.selectPageAtLine(d.node_id, d.source_line);
    }
  },
};

import { searchAnnotations, type AnnotationType } from "./ipc";
import {
  TYPE_ICON,
  truncateBody,
} from "../editor/livePreview/annotationConstants";
import { useWorkspaceStore } from "../stores/workspace";
import { globalJumpTracker } from "../editor/jumpTracker";
import type { PaletteProvider, PaletteResult, PaletteFilterOption } from "./paletteRegistry";

const FILTER_OPTIONS: PaletteFilterOption[] = [
  { id: "all", label: "All" },
  { id: "note", label: "note", icon: "N" },
  { id: "question", label: "question", icon: "?" },
  { id: "todo", label: "todo", icon: "T" },
  { id: "crossref", label: "crossref", icon: "→" },
  { id: "apparatus", label: "apparatus", icon: "⊕" },
  { id: "translation", label: "translation", icon: "译" },
];

export const annotationProvider: PaletteProvider = {
  id: "annotations",
  prefix: "@",
  label: "Annotations",
  priority: 20,
  filterOptions: FILTER_OPTIONS,

  async search(query: string, filter?: string): Promise<PaletteResult[]> {
    if (!query) return [];
    const annotationType = filter && filter !== "all" ? (filter as AnnotationType) : undefined;
    const results = await searchAnnotations(query, annotationType);
    return results.map((r) => ({
      id: `annotation-${r.annotation_id}`,
      title: r.node_title,
      subtitle: truncateBody(r.body),
      icon: TYPE_ICON[r.annotation_type],
      section: "Annotations",
      data: {
        node_id: r.node_id,
        source_line: r.source_line,
        annotation_id: r.annotation_id,
        certainty: r.certainty,
        date: r.date,
      },
    }));
  },

  onSelect(result: PaletteResult): void {
    const data = result.data as { node_id: string; source_line: number };
    const { currentPagePath, selectPageAtLine } = useWorkspaceStore.getState();

    globalJumpTracker.recordJump(
      { notePath: currentPagePath ?? "", line: 1, col: 0 },
      { notePath: data.node_id, line: data.source_line, col: 0 },
    );

    if (data.node_id === currentPagePath) {
      window.dispatchEvent(
        new CustomEvent("lit:scroll-to-line", {
          detail: { line: data.source_line, cursor: true },
        }),
      );
    } else {
      selectPageAtLine(data.node_id, data.source_line);
    }
  },
};

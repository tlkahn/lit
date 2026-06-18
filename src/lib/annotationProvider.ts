import { searchAnnotations, type AnnotationType } from "./ipc";
import {
  TYPE_ICON,
  truncateBody,
} from "../editor/livePreview/annotationConstants";
import { navigateToNote } from "./navigateToNote";
import { useWorkspaceStore } from "../stores/workspace";
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
    if (!query || !useWorkspaceStore.getState().graphReady) return [];
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
    navigateToNote(data.node_id, data.source_line);
  },
};

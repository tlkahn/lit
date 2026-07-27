import { useEffect, useState, useCallback, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { getCurrentEditorView } from "../lib/editorViewRef";
import { annotationDataField } from "../editor/livePreview/annotationState";
import { TYPE_ICON, getMarkIcon, certaintyMark, truncateBody } from "../editor/livePreview/annotationConstants";
import type { Annotation } from "../lib/ipc";
import { executeCommand } from "../lib/commandRegistry";
import { isFoldAllTarget } from "../editor/livePreview/annotationFoldAll";

interface AnnotationPanelProps {
  pageId: string;
  onCountChange?: (count: number) => void;
  contentHeight?: number;
}

function lineNumberAt(doc: { lineAt(pos: number): { number: number } }, pos: number): number {
  try {
    return doc.lineAt(pos).number;
  } catch {
    return 0;
  }
}

export function AnnotationPanel({ pageId, onCountChange, contentHeight }: AnnotationPanelProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>(() => {
    const view = getCurrentEditorView();
    if (!view) return [];
    const data = view.state.field(annotationDataField, false);
    return data ? [...data].sort((a, b) => a.char_start - b.char_start) : [];
  });
  const [highlightedCharStart, setHighlightedCharStart] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const entryRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const readAnnotations = useCallback(() => {
    setHighlightedCharStart(null);
    const view = getCurrentEditorView();
    if (!view) {
      setAnnotations([]);
      return;
    }
    const data = view.state.field(annotationDataField, false);
    if (!data) {
      setAnnotations([]);
      return;
    }
    const sorted = [...data].sort((a, b) => a.char_start - b.char_start);
    setAnnotations(sorted);
  }, []);

  useEffect(() => {
    readAnnotations();
  }, [pageId, readAnnotations]);

  useEffect(() => {
    const handler = () => readAnnotations();
    window.addEventListener("lit:annotations-changed", handler);
    return () => window.removeEventListener("lit:annotations-changed", handler);
  }, [readAnnotations]);

  useEffect(() => {
    onCountChange?.(annotations.length);
  }, [annotations.length, onCountChange]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.charStart != null) {
        setHighlightedCharStart(detail.charStart);
        const el = entryRefs.current.get(detail.charStart);
        if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("lit:show-annotation", handler);
    return () => window.removeEventListener("lit:show-annotation", handler);
  }, []);

  useEffect(() => {
    const view = getCurrentEditorView();
    if (!view) return;
    const handler = () => setHighlightedCharStart(null);
    view.dom.addEventListener("mousedown", handler);
    return () => view.dom.removeEventListener("mousedown", handler);
  }, [pageId]);

  const handleEntryClick = useCallback((ann: Annotation) => {
    setHighlightedCharStart(ann.char_start);
    const view = getCurrentEditorView();
    if (!view) return;
    view.dispatch({
      selection: { anchor: ann.char_start },
      effects: EditorView.scrollIntoView(ann.char_start, { y: "center" }),
    });
    view.focus();
  }, []);

  const view = getCurrentEditorView();
  const doc = view?.state.doc;

  const hasMultilineBlock = doc != null && annotations.some((ann) => isFoldAllTarget(doc, ann));

  return (
    <div className="flex h-full flex-col px-4 py-2">
      {hasMultilineBlock && (
        <div data-testid="annotation-panel-toolbar" className="mb-1 flex shrink-0 items-center justify-end">
          <button
            data-testid="annotation-panel-fold-all"
            aria-label="Collapse/expand all block annotations"
            title="Collapse/expand all block annotations (⌘⇧M)"
            onClick={() => executeCommand("app.toggleAllBlockAnnotations")}
            className="flex items-center px-1 text-xs text-text-muted hover:text-text-normal"
          >
            <span className="nerd-font" aria-hidden="true">{''}</span>
          </button>
        </div>
      )}
      {annotations.length === 0 ? (
        <p className="text-xs text-text-faint" data-testid="annotation-panel-empty">
          No annotations
        </p>
      ) : (
        <div
          ref={scrollRef}
          data-testid="annotations-scroll-container"
          className={`overflow-y-auto${contentHeight == null ? " min-h-0 flex-1" : ""}`}
          style={contentHeight != null ? { height: contentHeight } : undefined}
        >
          {annotations.map((ann, i) => {
            const lineNum = doc ? lineNumberAt(doc, ann.char_start) : 0;
            const isHighlighted = highlightedCharStart === ann.char_start;
            return (
              <div
                key={`${ann.char_start}-${ann.char_end}-${i}`}
                ref={(el) => {
                  if (el) entryRefs.current.set(ann.char_start, el);
                }}
                data-testid={`annotation-entry-${i}`}
                className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-xs hover:bg-bg-secondary ${isHighlighted ? "bg-bg-secondary" : ""}`}
                onClick={() => handleEntryClick(ann)}
              >
                <span
                  className="inline-flex shrink-0 items-center rounded px-1 py-0.5 text-[10px] font-semibold uppercase"
                  data-annotation-type={ann.annotation_type}
                  data-testid={`annotation-badge-${i}`}
                >
                  {ann.annotation_type === "mark"
                    ? getMarkIcon(ann.mark ?? "")
                    : (TYPE_ICON[ann.annotation_type] ?? "…")}
                </span>
                <span className="text-text-faint" data-testid={`annotation-certainty-${i}`}>
                  {certaintyMark(ann.certainty)}
                </span>
                {lineNum > 0 && (
                  <span className="text-text-faint" data-testid={`annotation-line-${i}`}>
                    L{lineNum}
                  </span>
                )}
                {ann.date && (
                  <span className="text-text-faint" data-testid={`annotation-date-${i}`}>
                    {ann.date}
                  </span>
                )}
                <span className="truncate text-text-muted" data-testid={`annotation-body-${i}`}>
                  {truncateBody(ann.body)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

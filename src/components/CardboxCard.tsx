import { useCallback, useRef } from "react";
import { TYPE_ICON, certaintyMark, truncateBody } from "../editor/livePreview/annotationConstants";
import type { CardboxAnnotation, AnnotationType } from "../lib/ipc";

interface CardboxCardProps {
  annotation: CardboxAnnotation;
  expanded: boolean;
  onToggleExpand: () => void;
  onNavigate: () => void;
}

export function CardboxCard({ annotation, expanded, onToggleExpand, onNavigate }: CardboxCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && expanded) {
        e.stopPropagation();
        onToggleExpand();
      }
    },
    [expanded, onToggleExpand],
  );

  const icon = TYPE_ICON[annotation.annotation_type as AnnotationType] ?? "…";

  const certainty = certaintyMark(annotation.certainty);

  return (
    <div
      ref={cardRef}
      className="cursor-pointer rounded-lg border border-border bg-bg-primary p-4 transition-all duration-200 ease-out hover:bg-bg-hover"
      onClick={onToggleExpand}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      data-testid="cardbox-card"
      data-expanded={expanded}
    >
      {/* Collapsed content - always visible */}
      <div className="flex items-start gap-2">
        <span
          className="inline-flex shrink-0 items-center rounded px-1 py-0.5 text-[10px] font-semibold uppercase"
          data-annotation-type={annotation.annotation_type}
          data-testid="card-type-badge"
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1 text-sm text-text-normal" data-testid="card-body">
          {expanded ? annotation.body : truncateBody(annotation.body, 120)}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs">
        {certainty && (
          <span className="font-semibold text-text-muted" data-testid="card-certainty">
            {certainty}
          </span>
        )}
        <span className="text-text-faint" data-testid="card-source">
          {annotation.source_page_title}
        </span>
      </div>

      {/* Expanded content */}
      <div
        className="overflow-hidden transition-all duration-200 ease-out"
        style={{
          maxHeight: expanded ? "2000px" : "0",
          opacity: expanded ? 1 : 0,
        }}
      >
        <div className="mt-3 space-y-2">
          {annotation.original && (
            <div
              className="border-l-2 border-interactive-accent bg-bg-secondary px-3 py-1 text-xs text-text-muted"
              data-testid="card-original"
            >
              {annotation.original}
            </div>
          )}
          {annotation.date && (
            <div className="text-xs text-text-faint" data-testid="card-date">
              {annotation.date}
            </div>
          )}
          <button
            className="text-xs text-text-accent underline hover:no-underline"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate();
            }}
            data-testid="card-navigate"
          >
            Open in document
          </button>
        </div>
      </div>
    </div>
  );
}

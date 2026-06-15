import { useCallback, useMemo, useRef, memo } from "react";
import { TYPE_ICON, certaintyMark, truncateBody } from "../editor/livePreview/annotationConstants";
import { renderMarkdown, renderInlineMarkdown } from "../lib/renderMarkdown";
import type { CardboxAnnotation, AnnotationType } from "../lib/ipc";

interface CardboxCardProps {
  annotation: CardboxAnnotation;
  expanded: boolean;
  onToggleExpand: () => void;
  onNavigate: () => void;
  linkedCards?: CardboxAnnotation[];
  onFocusCard?: (uuid: string) => void;
  onRemoveLink?: (targetUuid: string) => void;
}

export const CardboxCard = memo(function CardboxCard({ annotation, expanded, onToggleExpand, onNavigate, linkedCards, onFocusCard, onRemoveLink }: CardboxCardProps) {
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
  const renderedBody = useMemo(() => renderMarkdown(annotation.body ?? ""), [annotation.body]);
  const renderedOriginal = useMemo(() => renderInlineMarkdown(annotation.original ?? ""), [annotation.original]);

  return (
    <div
      ref={cardRef}
      className="cursor-pointer rounded-lg border border-border bg-bg-primary p-4 transition-all duration-200 ease-out hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-interactive-accent focus-visible:outline-none"
      onClick={onToggleExpand}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      data-testid="cardbox-card"
      data-uuid={annotation.uuid}
      data-annotation-type={annotation.annotation_type}
      data-expanded={expanded}
    >
      {/* Original quote - always visible when present */}
      {annotation.original && (
        <div
          className={`mb-2 border-l-2 bg-bg-secondary px-3 py-1 text-xs text-text-muted${expanded ? "" : " line-clamp-2"}`}
          data-testid="card-original"
          dangerouslySetInnerHTML={{ __html: renderedOriginal }}
        />
      )}

      {/* Collapsed content - always visible */}
      <div className="flex items-start gap-2">
        <span
          className="inline-flex shrink-0 items-center rounded px-1 py-0.5 text-[10px] font-semibold uppercase"
          data-annotation-type={annotation.annotation_type}
          data-testid="card-type-badge"
        >
          {icon}
        </span>
        <div
          className={`prose prose-sm min-w-0 flex-1 text-sm${expanded ? "" : " line-clamp-3"}`}
          data-testid="card-body"
          dangerouslySetInnerHTML={{ __html: renderedBody }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) e.stopPropagation();
          }}
        />
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
        {linkedCards && linkedCards.length > 0 && (
          <span className="text-text-faint" data-testid="card-link-count">
            &middot;{linkedCards.length}
          </span>
        )}
      </div>

      {/* Expanded content */}
      <div
        className="grid transition-all duration-200 ease-out"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          <div className="mt-3 space-y-2">
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
            {linkedCards && linkedCards.length > 0 && (
              <div
                data-testid="card-linked-section"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mt-2 text-[10px] font-semibold uppercase text-text-muted">Linked</div>
                <div className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                  {linkedCards.map((card) => (
                    <div
                      key={card.uuid}
                      className="group flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-bg-hover"
                      data-testid="linked-card-preview"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFocusCard?.(card.uuid);
                      }}
                    >
                      <span className="shrink-0 text-[10px]">
                        {TYPE_ICON[card.annotation_type as AnnotationType] ?? "…"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-text-muted">
                        {truncateBody(card.body ?? card.original, 60)}
                      </span>
                      <button
                        className="shrink-0 text-text-faint opacity-0 hover:text-text-normal group-hover:opacity-100"
                        aria-label="Remove link"
                        data-testid="remove-link-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveLink?.(card.uuid);
                        }}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

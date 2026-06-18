import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { TYPE_ICON, certaintyMark, truncateBody } from "../editor/livePreview/annotationConstants";
import { renderMarkdown, renderInlineMarkdown } from "../lib/renderMarkdown";
import type { CardboxAnnotation, AnnotationType } from "../lib/ipc";

/** Inline sub-component: slip-note editor for a card. */
function CardNoteEditor({
  note,
  onSetNote,
  onExportNote,
}: {
  note?: string;
  onSetNote?: (body: string) => void;
  onExportNote?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelingRef = useRef(false);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  const startEditing = useCallback(() => {
    cancelingRef.current = false;
    setDraft(note ?? "");
    setEditing(true);
    // Auto-focus + resize after mount
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      autoResize();
    });
  }, [note, autoResize]);

  const commitDraft = useCallback(() => {
    if (cancelingRef.current) return;
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (note ?? "")) {
      onSetNote?.(trimmed);
    }
  }, [draft, note, onSetNote]);

  const renderedNote = useMemo(
    () => (note ? renderMarkdown(note) : ""),
    [note],
  );

  // Empty state: show placeholder button
  if (!note && !editing) {
    return (
      <button
        className="pt-2 text-xs text-text-faint hover:text-text-muted"
        data-testid="card-note-add"
        onClick={(e) => {
          e.stopPropagation();
          startEditing();
        }}
      >
        + Add note
      </button>
    );
  }

  // Editing state: textarea
  if (editing) {
    return (
      <div className="pt-2" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <textarea
          ref={textareaRef}
          className="w-full resize-none rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-text-normal focus:border-interactive-accent focus:outline-none"
          style={{ minHeight: "60px" }}
          data-testid="card-note-textarea"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            autoResize();
          }}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              cancelingRef.current = true;
              setEditing(false);
            }
          }}
          rows={3}
          placeholder="Write a slip note..."
        />
      </div>
    );
  }

  // Display state: rendered markdown + edit/export buttons
  return (
    <div className="pt-2" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="text-[10px] font-semibold uppercase text-text-muted">Note</div>
      <div
        className="prose prose-sm pt-1 cursor-text text-xs"
        data-testid="card-note-display"
        dangerouslySetInnerHTML={{ __html: renderedNote }}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("a")) {
            startEditing();
          }
        }}
      />
      <div className="pt-1 flex gap-2">
        <button
          className="text-[10px] text-text-faint hover:text-text-muted"
          data-testid="card-note-edit"
          onClick={startEditing}
        >
          Edit
        </button>
        {onExportNote && (
          <button
            className="text-[10px] text-text-faint hover:text-text-muted"
            data-testid="card-note-export"
            onClick={onExportNote}
          >
            Export
          </button>
        )}
      </div>
    </div>
  );
}

interface CardboxCardProps {
  annotation: CardboxAnnotation;
  expanded: boolean;
  isPinned?: boolean;
  isSelected?: boolean;
  colorTag?: string;
  onToggleExpand: () => void;
  onNavigate: () => void;
  linkedCards?: CardboxAnnotation[];
  onFocusCard?: (uuid: string) => void;
  onRemoveLink?: (targetUuid: string) => void;
  note?: string;
  onSetNote?: (body: string) => void;
  onExportNote?: () => void;
  onShowConnections?: () => void;
}

export const CardboxCard = memo(function CardboxCard({ annotation, expanded, isPinned, isSelected, colorTag, onToggleExpand, onNavigate, linkedCards, onFocusCard, onRemoveLink, note, onSetNote, onExportNote, onShowConnections }: CardboxCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const prevPinnedRef = useRef(isPinned);
  const [justPinned, setJustPinned] = useState(false);

  useEffect(() => {
    if (isPinned && !prevPinnedRef.current) {
      setJustPinned(true);
      const timer = setTimeout(() => setJustPinned(false), 400);
      prevPinnedRef.current = isPinned;
      return () => clearTimeout(timer);
    }
    prevPinnedRef.current = isPinned;
    setJustPinned(false);
  }, [isPinned]);

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
      className={`relative cursor-pointer rounded-lg border bg-bg-primary p-4 transition-all duration-200 ease-out hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-interactive-accent focus-visible:outline-none ${isPinned ? "border-interactive-accent" : "border-border"}${isSelected ? " ring-2 ring-interactive-accent ring-offset-1 ring-offset-bg-primary" : ""}${justPinned ? " cardbox-pin-pulse" : ""}`}
      style={{ height: "100%", overflow: expanded ? "visible" : "hidden" }}
      onClick={onToggleExpand}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      data-testid="cardbox-card"
      data-uuid={annotation.uuid}
      data-annotation-type={annotation.annotation_type}
      data-expanded={expanded}
      data-pinned={isPinned || undefined}
      data-color-tag={colorTag || undefined}
    >
      {isPinned && (
        <span
          className="nerd-font absolute top-2 right-2 text-sm text-interactive-accent"
          data-testid="pin-icon"
          aria-hidden="true"
        >{'󰐃'}</span>
      )}
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
        {note && (
          <span
            className="text-text-faint"
            data-testid="card-note-indicator"
            title="Has slip note"
          >&#9998;</span>
        )}
      </div>

      {/* Expanded content — absolute overlay so it doesn't disturb grid geometry */}
      {expanded && (
        <div
          className="absolute left-0 right-0 rounded-b-lg border border-t-0 border-border bg-bg-primary p-4 shadow-lg"
          style={{ top: "100%", zIndex: 20 }}
        >
          <div className="space-y-2">
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
            {onShowConnections && (
              <button
                className="text-xs text-text-accent underline hover:no-underline"
                onClick={(e) => {
                  e.stopPropagation();
                  onShowConnections();
                }}
                data-testid="card-show-connections"
              >
                Show connections
              </button>
            )}
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
            {onSetNote && (
              <CardNoteEditor
                note={note}
                onSetNote={onSetNote}
                onExportNote={onExportNote}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
});

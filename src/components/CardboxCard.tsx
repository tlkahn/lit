import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { TYPE_ICON, certaintyMark, truncateBody } from "../editor/livePreview/annotationConstants";
import { renderMarkdown, renderInlineMarkdown } from "../lib/renderMarkdown";
import type { CardboxAnnotation, AnnotationType } from "../lib/ipc";

/** Inline sub-component: slip-note editor body (textarea / display states). */
function CardNoteEditor({
  note,
  editing,
  onStartEditing,
  onStopEditing,
  onSetNote,
  onExportNote,
}: {
  note?: string;
  editing: boolean;
  onStartEditing: () => void;
  onStopEditing: () => void;
  onSetNote?: (body: string) => void;
  onExportNote?: () => void;
}) {
  const [draft, setDraft] = useState(note ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelingRef = useRef(false);
  const initializedRef = useRef(false);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  // Entering edit mode: reset draft, auto-focus + resize after mount.
  useEffect(() => {
    if (!editing) { initializedRef.current = false; return; }
    if (initializedRef.current) return;
    initializedRef.current = true;
    cancelingRef.current = false;
    setDraft(note ?? "");
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      autoResize();
    });
  }, [editing, note, autoResize]);

  const commitDraft = useCallback(() => {
    if (cancelingRef.current) return;
    onStopEditing();
    const trimmed = draft.trim();
    if (trimmed !== (note ?? "")) {
      onSetNote?.(trimmed);
    }
  }, [draft, note, onSetNote, onStopEditing]);

  const renderedNote = useMemo(
    () => (note ? renderMarkdown(note) : ""),
    [note],
  );

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
              onStopEditing();
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
            onStartEditing();
          }
        }}
      />
      <div className="pt-1 flex gap-2">
        <button
          className="text-[10px] text-text-muted hover:text-text-normal"
          data-testid="card-note-edit"
          onClick={onStartEditing}
        >
          Edit
        </button>
        {onExportNote && (
          <button
            className="text-[10px] text-text-muted hover:text-text-normal"
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
  const [flipped, setFlipped] = useState(false);
  const [noteEditing, setNoteEditing] = useState(false);
  const canFlip = Boolean(annotation.original);

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
      if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.altKey && canFlip) {
        e.preventDefault();
        e.stopPropagation();
        setFlipped((v) => !v);
      }
    },
    [expanded, onToggleExpand, canFlip],
  );

  const icon = TYPE_ICON[annotation.annotation_type as AnnotationType] ?? "…";
  const certainty = certaintyMark(annotation.certainty);
  const renderedBody = useMemo(() => renderMarkdown(annotation.body ?? ""), [annotation.body]);
  const renderedOriginal = useMemo(() => renderInlineMarkdown(annotation.original ?? ""), [annotation.original]);

  return (
    <div
      ref={cardRef}
      className={`relative cursor-pointer rounded-lg border bg-bg-primary p-4 transition-all duration-200 ease-out hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-interactive-accent focus-visible:outline-none ${isPinned ? "border-interactive-accent" : "border-border"}${isSelected ? " ring-2 ring-interactive-accent ring-offset-1 ring-offset-bg-primary" : ""}${justPinned ? " cardbox-pin-pulse" : ""}`}
      onClick={onToggleExpand}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      data-testid="cardbox-card"
      data-uuid={annotation.uuid}
      data-annotation-type={annotation.annotation_type}
      data-expanded={expanded}
      data-pinned={isPinned || undefined}
      data-color-tag={colorTag || undefined}
      data-flipped={flipped}
    >
      <div className="absolute top-2 right-2 flex items-center gap-1">
        {isPinned && (
          <span
            className="nerd-font text-sm text-interactive-accent"
            data-testid="pin-icon"
            aria-hidden="true"
          >{'\u{F0403}'}</span>
        )}
        {canFlip && (
          <button
            type="button"
            className="nerd-font text-sm text-text-muted hover:text-text-normal"
            data-testid="card-flip"
            aria-label={flipped ? "Show annotation" : "Show original quote"}
            onClick={(e) => {
              e.stopPropagation();
              setFlipped((v) => !v);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >{''}</button>
        )}
      </div>
      <div className="cardbox-card-scene">
        <div className={`cardbox-card-rotator${flipped ? " is-flipped" : ""}`}>
          <div className="cardbox-card-face cardbox-card-face-front" data-testid="card-face-front" aria-hidden={flipped}>
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

            {/* Expanded content */}
            <div
              className="grid transition-all duration-200 ease-out"
              style={{
                gridTemplateRows: expanded ? "1fr" : "0fr",
                opacity: expanded ? 1 : 0,
              }}
            >
              <div className="overflow-hidden" {...(!expanded ? { inert: "" as unknown as boolean } : {})}>
                <div className="mt-3 space-y-2">
                  {annotation.date && (
                    <div className="text-xs text-text-faint" data-testid="card-date">
                      {annotation.date}
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      className="flex items-center gap-1 text-xs text-text-muted hover:text-text-normal"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigate();
                      }}
                      data-testid="card-navigate"
                    >
                      <span className="nerd-font" aria-hidden="true">{'\u{F0219}'}</span>
                      Open in document
                    </button>
                    {onShowConnections && (
                      <button
                        className="flex items-center gap-1 text-xs text-text-muted hover:text-text-normal"
                        onClick={(e) => {
                          e.stopPropagation();
                          onShowConnections();
                        }}
                        data-testid="card-show-connections"
                      >
                        <span className="nerd-font" aria-hidden="true">{'\u{F0339}'}</span>
                        Show connections
                      </button>
                    )}
                    {onSetNote && !note && !noteEditing && (
                      <button
                        className="flex items-center gap-1 text-xs text-text-muted hover:text-text-normal"
                        data-testid="card-note-add"
                        onClick={(e) => {
                          e.stopPropagation();
                          setNoteEditing(true);
                        }}
                      >
                        <span className="nerd-font" aria-hidden="true">{''}</span> Add note
                      </button>
                    )}
                  </div>
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
                  {onSetNote && (note || noteEditing) && (
                    <CardNoteEditor
                      note={note}
                      editing={noteEditing}
                      onStartEditing={() => setNoteEditing(true)}
                      onStopEditing={() => setNoteEditing(false)}
                      onSetNote={onSetNote}
                      onExportNote={onExportNote}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
          {canFlip && (
            <div className="cardbox-card-face cardbox-card-face-back" data-testid="card-face-back" aria-hidden={!flipped}>
              <div
                className="border-l-2 bg-bg-secondary px-3 py-1 text-xs text-text-muted"
                data-testid="card-original"
                dangerouslySetInnerHTML={{ __html: renderedOriginal }}
              />
              <div className="mt-2 text-xs text-text-faint" data-testid="card-source">
                {annotation.source_page_title}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

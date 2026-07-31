import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { flushSync } from "react-dom";
import { canAnimateFlip, runFlipAnimation } from "./cardFlipAnimation";
import { TYPE_ICON, certaintyMark, truncateBody } from "../editor/livePreview/annotationConstants";
import { renderMarkdown, renderInlineMarkdown } from "../lib/renderMarkdown";
import type { CardboxAnnotation, AnnotationType } from "../lib/ipc";

/** Inline sub-component: slip-note editor body (textarea / display states). */
function CardNoteEditor({
  note,
  editing,
  prefill,
  onStartEditing,
  onStopEditing,
  onSetNote,
  onExportNote,
  onPrefillConsumed,
}: {
  note?: string;
  editing: boolean;
  prefill?: string;
  onStartEditing: () => void;
  onStopEditing: () => void;
  onSetNote?: (body: string) => void;
  onExportNote?: () => void;
  onPrefillConsumed?: () => void;
}) {
  const [draft, setDraft] = useState(note ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelingRef = useRef(false);
  const initializedRef = useRef(false);
  const appliedPrefillRef = useRef<string | null>(null);

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

  // Quote prefill (#968): append the staged blockquote to whatever the init
  // effect put in the draft. Declared AFTER the init effect and using the
  // functional updater so it composes with the init effect's queued update
  // when both fire in the same commit.
  useEffect(() => {
    if (!editing || prefill == null) {
      appliedPrefillRef.current = null;
      return;
    }
    if (appliedPrefillRef.current === prefill) return;
    appliedPrefillRef.current = prefill;
    setDraft((d) => (d.trim() ? `${d.replace(/\n+$/, "")}\n\n${prefill}\n\n` : `${prefill}\n\n`));
    onPrefillConsumed?.();
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      autoResize();
    });
  }, [editing, prefill, onPrefillConsumed, autoResize]);

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
      // Defensive-only click guard; must never swallow pointerdown (#968).
      <div className="pt-2" onClick={(e) => e.stopPropagation()}>
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
    // Defensive-only click guard; must never swallow pointerdown (#968).
    <div className="pt-2" onClick={(e) => e.stopPropagation()}>
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

export function showCardFlipped(flipped: boolean, canFlip: boolean): boolean {
  return flipped && canFlip;
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
  onFocusCard?: (uuid: string, highlightNote?: boolean) => void;
  onRemoveLink?: (targetUuid: string) => void;
  note?: string;
  onSetNote?: (body: string) => void;
  onExportNote?: () => void;
  onShowConnections?: () => void;
  notePrefill?: string;
  onNotePrefillConsumed?: () => void;
}

export const CardboxCard = memo(function CardboxCard({ annotation, expanded, isPinned, isSelected, colorTag, onToggleExpand, onNavigate, linkedCards, onFocusCard, onRemoveLink, note, onSetNote, onExportNote, onShowConnections, notePrefill, onNotePrefillConsumed }: CardboxCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const animatingRef = useRef(false);
  const prevPinnedRef = useRef(isPinned);
  const [justPinned, setJustPinned] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [noteEditing, setNoteEditing] = useState(false);
  const canFlip = Boolean(annotation.original);
  if (!canFlip && flipped) {
    setFlipped(false);
  }
  const showFlipped = showCardFlipped(flipped, canFlip);

  // A staged quote prefill auto-opens the note editor, unflipping first —
  // the editor only mounts on the front face. Expanding the card is
  // CardboxView's job (#968).
  useEffect(() => {
    if (notePrefill != null) {
      setFlipped(false);
      setNoteEditing(true);
    }
  }, [notePrefill]);

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

  const flipCard = useCallback(() => {
    if (!canFlip || animatingRef.current) return;
    const root = cardRef.current;
    const stage = stageRef.current;
    const active = document.activeElement as HTMLElement | null;
    const insideFace = Boolean(
      active && root && active !== root && stage?.contains(active),
    );
    const refocus = () => {
      if (insideFace) requestAnimationFrame(() => root?.focus());
    };
    if (!stage || !canAnimateFlip(stage)) {
      setFlipped((v) => !v);
      refocus();
      return;
    }
    animatingRef.current = true;
    // flushSync so the face swap commits between the two animation phases.
    void runFlipAnimation(stage, () => flushSync(() => setFlipped((v) => !v)))
      .finally(() => {
        animatingRef.current = false;
        refocus();
      });
  }, [canFlip]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || target.isContentEditable) return;
      if (e.key === "Escape" && expanded) {
        e.stopPropagation();
        onToggleExpand();
      }
      if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.altKey && canFlip) {
        e.preventDefault();
        e.stopPropagation();
        flipCard();
      }
    },
    [expanded, onToggleExpand, canFlip, flipCard],
  );

  const icon = TYPE_ICON[annotation.annotation_type as AnnotationType] ?? "…";
  const certainty = certaintyMark(annotation.certainty);
  const renderedBody = useMemo(() => renderMarkdown(annotation.body ?? ""), [annotation.body]);
  const renderedOriginal = useMemo(() => renderInlineMarkdown(annotation.original ?? ""), [annotation.original]);

  return (
    <div
      ref={cardRef}
      className={`relative rounded-lg border bg-bg-primary p-4 transition-all duration-200 ease-out hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-interactive-accent focus-visible:outline-none ${isPinned ? "border-interactive-accent" : "border-border"}${isSelected ? " ring-2 ring-interactive-accent ring-offset-1 ring-offset-bg-primary" : ""}${justPinned ? " cardbox-pin-pulse" : ""}`}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      data-testid="cardbox-card"
      data-uuid={annotation.uuid}
      data-annotation-type={annotation.annotation_type}
      data-expanded={expanded}
      data-pinned={isPinned || undefined}
      data-color-tag={colorTag || undefined}
      data-flipped={showFlipped}
    >
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
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
            className="nerd-font text-sm text-text-muted hover:text-text-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive-accent"
            data-testid="card-flip"
            aria-label={showFlipped ? "Show annotation" : "Show original quote"}
            aria-pressed={showFlipped}
            title={showFlipped ? "Show annotation (F)" : "Show original quote (F)"}
            onClick={flipCard}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
              }
            }}
          >{'\u{F2F1}'}</button>
        )}
        <button
          type="button"
          className="text-text-muted hover:text-text-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive-accent"
          data-testid="card-expand-toggle"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse card" : "Expand card"}
          title={expanded ? "Collapse card" : "Expand card"}
          onClick={onToggleExpand}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
            }
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className={`transition-transform duration-200${expanded ? " rotate-180" : ""}`}
            aria-hidden="true"
          >
            <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="cardbox-card-stage" ref={stageRef} data-testid="card-flip-stage">
        {!showFlipped ? (
          <div className="pr-14" data-testid="card-face-front">
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
              {!canFlip && annotation.source_page_title && (
                <button
                  type="button"
                  className="text-text-muted hover:text-text-normal"
                  data-testid="card-source"
                  onClick={onNavigate}
                >
                  {annotation.source_page_title}
                </button>
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
                      onClick={onNavigate}
                      data-testid="card-navigate"
                    >
                      <span className="nerd-font" aria-hidden="true">{'\u{F0219}'}</span>
                      Open in document
                    </button>
                    {onShowConnections && (
                      <button
                        className="flex items-center gap-1 text-xs text-text-muted hover:text-text-normal"
                        onClick={onShowConnections}
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
                        onClick={() => setNoteEditing(true)}
                      >
                        <span className="nerd-font" aria-hidden="true">{'\u{F0FE}'}</span> Add note
                      </button>
                    )}
                  </div>
                  {linkedCards && linkedCards.length > 0 && (
                    // Defensive-only click guard; must never swallow pointerdown (#968).
                    <div
                      data-testid="card-linked-section"
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
                      prefill={notePrefill}
                      onStartEditing={() => setNoteEditing(true)}
                      onStopEditing={() => setNoteEditing(false)}
                      onSetNote={onSetNote}
                      onExportNote={onExportNote}
                      onPrefillConsumed={onNotePrefillConsumed}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="pr-14" data-testid="card-face-back">
            <div
              className={`border-l-2 bg-bg-secondary px-3 py-1 text-xs text-text-muted${expanded ? "" : " line-clamp-2"}`}
              data-testid="card-original"
              dangerouslySetInnerHTML={{ __html: renderedOriginal }}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) e.stopPropagation();
              }}
            />
            {annotation.source_page_title && (
              <button
                type="button"
                className="mt-2 text-xs text-text-muted hover:text-text-normal"
                data-testid="card-source"
                onClick={onNavigate}
              >
                {annotation.source_page_title}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

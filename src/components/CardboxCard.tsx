import { useCallback, useEffect, useMemo, useRef, useState, memo, Fragment } from "react";
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

/** Shared chrome for vertical action-strip icon buttons (#981). */
const STRIP_BTN_CLASS =
  "nerd-font p-1.5 text-sm text-text-muted hover:text-text-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive-accent";

/** Keep Enter/Space from bubbling to grid keyboard handlers. */
function stopStripKeyDown(e: React.KeyboardEvent) {
  if (e.key === "Enter" || e.key === " ") e.stopPropagation();
}

function StripButton({
  testId,
  label,
  glyph,
  onClick,
  title,
  pressed,
  expanded,
  tabIndex,
  onFocus,
  buttonRef,
  children,
  className,
}: {
  testId: string;
  label: string;
  glyph?: string;
  onClick: () => void;
  title?: string;
  pressed?: boolean;
  expanded?: boolean;
  tabIndex?: number;
  onFocus?: () => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className ?? STRIP_BTN_CLASS}
      data-testid={testId}
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      tabIndex={tabIndex}
      ref={buttonRef}
      onClick={onClick}
      onFocus={onFocus}
      onKeyDown={stopStripKeyDown}
    >
      {children ?? glyph}
    </button>
  );
}

interface StripAction {
  testId: string;
  label: string;
  title?: string;
  onClick: () => void;
  pressed?: boolean;
  expanded?: boolean;
  glyph?: string;
  children?: React.ReactNode;
  /** Insert separator before this action when rendering. */
  separatorBefore?: boolean;
  className?: string;
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
  // Monotonic run id: midpoint only applies if this flip is still current.
  // Invalidated by ensureFrontFace so add-note/prefill win over in-flight flips.
  const flipRunRef = useRef(0);
  const prevPinnedRef = useRef(isPinned);
  const [justPinned, setJustPinned] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [noteEditing, setNoteEditing] = useState(false);
  const canFlip = Boolean(annotation.original);
  if (!canFlip && flipped) {
    setFlipped(false);
  }
  const showFlipped = showCardFlipped(flipped, canFlip);

  // Force front face and invalidate any in-flight flip so its midpoint cannot
  // re-invert us. Best-effort WAAPI cancel is a prod-only extra (jsdom has none).
  // Clear animatingRef synchronously so a fresh flip can start immediately —
  // waiting for the stale run's finally would leave a dead window (#982).
  const ensureFrontFace = useCallback(() => {
    flipRunRef.current++;
    animatingRef.current = false;
    stageRef.current?.getAnimations?.().forEach((a) => a.cancel());
    setFlipped(false);
  }, []);

  // A staged quote prefill auto-opens the note editor, unflipping first —
  // the editor only mounts on the front face. Expanding the card is
  // CardboxView's job (#968).
  useEffect(() => {
    if (notePrefill != null) {
      ensureFrontFace();
      setNoteEditing(true);
    }
  }, [notePrefill, ensureFrontFace]);

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
    const run = ++flipRunRef.current;
    // flushSync so the face swap commits between the two animation phases.
    // Guarded by flipRunRef so ensureFrontFace can invalidate mid-flight.
    void runFlipAnimation(stage, () => {
      if (flipRunRef.current === run) {
        flushSync(() => setFlipped((v) => !v));
      }
    })
      .finally(() => {
        // Only the owning run may reset animatingRef / steal focus. A stale
        // run invalidated by ensureFrontFace must not clobber a fresh flip
        // or yank focus off the note editor (#982).
        if (flipRunRef.current === run) {
          animatingRef.current = false;
          refocus();
        }
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

  const stripActions = useMemo((): StripAction[] => {
    const actions: StripAction[] = [];
    if (canFlip) {
      actions.push({
        testId: "card-flip",
        label: showFlipped ? "Show annotation" : "Show original quote",
        title: showFlipped ? "Show annotation (F)" : "Show original quote (F)",
        glyph: "\u{F2F1}",
        onClick: flipCard,
        pressed: showFlipped,
      });
    }
    actions.push({
      testId: "card-expand-toggle",
      label: expanded ? "Collapse card" : "Expand card",
      onClick: onToggleExpand,
      expanded,
      // Match prior expand chrome (no nerd-font / text-sm); SVG is the glyph.
      className:
        "p-1.5 text-text-muted hover:text-text-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive-accent",
      children: (
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
      ),
    });
    actions.push({
      testId: "card-navigate",
      label: "Open in document",
      glyph: "\u{F0219}",
      onClick: onNavigate,
      separatorBefore: true,
    });
    if (onShowConnections) {
      actions.push({
        testId: "card-show-connections",
        label: "Show connections",
        glyph: "\u{F0339}",
        onClick: onShowConnections,
      });
    }
    if (onSetNote && !note && !noteEditing) {
      actions.push({
        testId: "card-note-add",
        label: "Add note",
        glyph: "\u{F0FE}",
        onClick: () => {
          ensureFrontFace();
          setNoteEditing(true);
          if (!expanded) onToggleExpand();
        },
      });
    }
    return actions;
  }, [
    canFlip,
    showFlipped,
    flipCard,
    expanded,
    onToggleExpand,
    onNavigate,
    onShowConnections,
    onSetNote,
    note,
    noteEditing,
    ensureFrontFace,
  ]);

  const [stripActiveIdx, setStripActiveIdx] = useState(0);
  const stripBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const stripClampedIdx =
    stripActions.length === 0 ? 0 : Math.min(stripActiveIdx, stripActions.length - 1);

  const handleStripKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (stripActions.length === 0) return;
      const last = stripActions.length - 1;
      let next: number | null = null;
      if (e.key === "ArrowDown") next = Math.min(stripClampedIdx + 1, last);
      else if (e.key === "ArrowUp") next = Math.max(stripClampedIdx - 1, 0);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = last;
      else return;
      e.preventDefault();
      e.stopPropagation();
      setStripActiveIdx(next);
      stripBtnRefs.current[next]?.focus();
    },
    [stripActions.length, stripClampedIdx],
  );

  const icon = TYPE_ICON[annotation.annotation_type as AnnotationType] ?? "…";
  const certainty = certaintyMark(annotation.certainty);
  const renderedBody = useMemo(() => renderMarkdown(annotation.body ?? ""), [annotation.body]);
  const renderedOriginal = useMemo(() => renderInlineMarkdown(annotation.original ?? ""), [annotation.original]);

  return (
    <div
      ref={cardRef}
      className={`relative flex rounded-lg border bg-bg-primary p-4 transition-all duration-200 ease-out hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-interactive-accent focus-visible:outline-none ${isPinned ? "border-interactive-accent" : "border-border"}${isSelected ? " ring-2 ring-interactive-accent ring-offset-1 ring-offset-bg-primary" : ""}${justPinned ? " cardbox-pin-pulse" : ""}`}
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
      {/* Vertical action strip on the right edge (#981). Negative margins
          (-mt-3.5 -mr-3.5 = 14px) cancel the root's p-4 (16px) so the strip
          sits ~2px from the card edge, matching the old top/right-0.5 inset.
          DOM-first + order-last: tab order matches visual top-right priority
          while flex keeps the strip on the right. */}
      <div
        role="toolbar"
        aria-label="Card actions"
        aria-orientation="vertical"
        data-testid="card-action-strip"
        className="order-last z-10 -mt-3.5 -mr-3.5 ml-1 flex shrink-0 flex-col items-center"
        onKeyDown={handleStripKeyDown}
      >
        {isPinned && (
          <span
            className="nerd-font p-1.5 text-sm text-interactive-accent"
            data-testid="pin-icon"
            role="img"
            aria-label="Pinned"
          >{'\u{F0403}'}</span>
        )}
        {stripActions.map((action, i) => (
          <Fragment key={action.testId}>
            {action.separatorBefore && (
              <div
                aria-hidden="true"
                data-testid="card-strip-separator"
                className="my-0.5 h-px w-4 bg-border"
              />
            )}
            <StripButton
              testId={action.testId}
              label={action.label}
              title={action.title}
              glyph={action.glyph}
              onClick={action.onClick}
              pressed={action.pressed}
              expanded={action.expanded}
              className={action.className}
              tabIndex={i === stripClampedIdx ? 0 : -1}
              onFocus={() => setStripActiveIdx(i)}
              buttonRef={(el) => {
                stripBtnRefs.current[i] = el;
              }}
            >
              {action.children}
            </StripButton>
          </Fragment>
        ))}
      </div>
      <div className="cardbox-card-stage min-w-0 flex-1" ref={stageRef} data-testid="card-flip-stage">
        {!showFlipped ? (
          <div data-testid="card-face-front">
            <div className="flex items-start gap-2">
              <span
                className="inline-flex shrink-0 items-center rounded px-1 py-0.5 text-[10px] font-semibold uppercase"
                data-annotation-type={annotation.annotation_type}
                data-testid="card-type-badge"
              >
                {icon}
              </span>
              <div
                className={`prose prose-sm min-w-0 flex-1 cursor-text text-sm${expanded ? "" : " line-clamp-3"}`}
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
          <div data-testid="card-face-back">
            <div
              className={`cursor-text border-l-2 bg-bg-secondary px-3 py-1 text-xs text-text-muted${expanded ? "" : " line-clamp-2"}`}
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

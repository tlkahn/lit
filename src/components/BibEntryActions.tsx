import { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { SpinnerSvg } from "./SpinnerSvg";
import { useOverflowMenu } from "../hooks/useOverflowMenu";
import type { BibEntry, BibKeyState } from "../lib/ipc";

export interface BibActionDescriptor {
  key: string;
  icon: string;
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  spinner?: boolean;
  renderContent?: React.ReactNode;
}

export interface BibEntryActionProps {
  entry: BibEntry;
  state: BibKeyState | undefined;
  ocrCompanionCurrent: string | false | undefined;
  isMaterializing: boolean;
  isEnriching: boolean;
  enrichPhase: "fetch" | "search";
  isDownloading: boolean;
  downloadProgress: { bytes: number; total: number | null } | null;
  isLinking: boolean;
  onOpenNote: (pageId: string) => void;
  onCreateNote: (key: string) => void;
  onEnrich: (entry: BibEntry) => void;
  onOpenPdf: (file: string) => void;
  onOpenMarkdown: (filename: string) => void;
  onOcr: (entry: BibEntry) => void;
  onCopyCitation: (key: string) => void;
  onDownloadPdf: (entry: BibEntry) => void;
  onLinkPdf: (entry: BibEntry) => void;
}

const TRIGGER_WIDTH = 28;

const BUTTON_CLASS =
  "inline-flex items-center justify-center rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover disabled:opacity-50";

export function BibEntryActions(props: BibEntryActionProps) {
  const {
    entry, state,
    ocrCompanionCurrent,
    isMaterializing, isEnriching, enrichPhase,
    isDownloading, downloadProgress, isLinking,
    onOpenNote, onCreateNote, onEnrich, onOpenPdf, onOcr,
    onOpenMarkdown, onCopyCitation, onDownloadPdf, onLinkPdf,
  } = props;

  const actions = useMemo<BibActionDescriptor[]>(() => {
    const list: BibActionDescriptor[] = [];

    if (state?.page_id) {
      list.push({
        key: "open-note",
        icon: "󰈙",
        label: "Open note",
        title: `Open note: ${state.page_id}`,
        onClick: () => onOpenNote(state.page_id!),
        testId: "has-note-link",
      });
    } else if (state) {
      const createLabel = isMaterializing ? "Creating…" : "Create note";
      list.push({
        key: "create-note",
        icon: "󰝒",
        label: createLabel,
        onClick: () => onCreateNote(entry.key),
        disabled: isMaterializing,
        testId: "create-note-btn",
        spinner: isMaterializing,
      });
    }

    if (!state?.page_id && (state?.materialization !== "partial" || isEnriching)) {
      const enrichLabel = isEnriching
        ? (enrichPhase === "fetch" ? "Fetching…" : "Searching providers…")
        : "Fetch details";
      list.push({
        key: "enrich",
        icon: "󰇚",
        label: enrichLabel,
        onClick: () => onEnrich(entry),
        disabled: isEnriching,
        testId: "fetch-details-btn",
        spinner: isEnriching,
      });
    }

    if (typeof ocrCompanionCurrent === "string") {
      list.push({
        key: "open-markdown",
        icon: "󰈤",
        label: "Open markdown",
        onClick: () => onOpenMarkdown(ocrCompanionCurrent),
        testId: "open-markdown-btn",
      });
    }

    if (entry.file) {
      list.push({
        key: "open-pdf",
        icon: "󰈦",
        label: "Open PDF",
        title: `Open PDF: ${entry.file}`,
        onClick: () => onOpenPdf(entry.file!),
        testId: "open-pdf-btn",
      });
      if (!ocrCompanionCurrent) {
        list.push({
          key: "ocr",
          icon: "󱄄",
          label: "OCR to Markdown",
          onClick: () => onOcr(entry),
          testId: "ocr-btn",
        });
      }
    }

    list.push({
      key: "copy-citation",
      icon: "󰆏",
      label: "Copy citation",
      onClick: () => onCopyCitation(entry.key),
    });

    if (!entry.file && (entry.doi || entry.arxiv_id)) {
      const dlLabel = isDownloading
        ? downloadProgress
          ? downloadProgress.total
            ? `Downloading ${Math.round((downloadProgress.bytes / downloadProgress.total) * 100)}%`
            : "Downloading…"
          : "Resolving…"
        : "Download PDF";
      list.push({
        key: "download-pdf",
        icon: "󰇚",
        label: dlLabel,
        onClick: () => onDownloadPdf(entry),
        disabled: isDownloading || isLinking,
        testId: "download-pdf-btn",
        spinner: isDownloading,
        renderContent: isDownloading
          ? <>{downloadProgress?.total ? <span>{Math.round((downloadProgress.bytes / downloadProgress.total) * 100)}%</span> : null}</>
          : undefined,
      });
    }

    const linkLabel = isLinking
      ? "Linking…"
      : entry.file
        ? "Re-link PDF"
        : "Link PDF";
    list.push({
      key: "link-pdf",
      icon: "󰌷",
      label: linkLabel,
      onClick: () => onLinkPdf(entry),
      disabled: isLinking || isDownloading,
      testId: "link-pdf-btn",
      spinner: isLinking,
    });

    return list;
  }, [
    entry, state,
    onOpenNote, onCreateNote, onEnrich, onOpenPdf, onOcr,
    onOpenMarkdown, onCopyCitation, onDownloadPdf, onLinkPdf,
    isMaterializing, isEnriching, enrichPhase,
    isDownloading, downloadProgress, isLinking,
    ocrCompanionCurrent,
  ]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(actions.length);
  const widthsRef = useRef<number[]>([]);
  const needsRemeasureRef = useRef(false);
  const { open, setOpen, triggerRef, menuRef } = useOverflowMenu();

  // Close the overflow menu when the action set structurally changes
  // (e.g., download completes: "Download PDF" disappears, "Open PDF" + "OCR" appear).
  // We watch actions.length rather than actions to avoid closing on label-only
  // updates (e.g., download progress percentage changes).
  useEffect(() => {
    setOpen(false);
  }, [actions.length]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Reset cached widths when action set changes (new buttons appear/disappear)
    widthsRef.current = [];
    setVisibleCount(actions.length);

    // gap-1.5 = 6px
    const GAP = 6;

    function measure() {
      const el = containerRef.current;
      if (!el) return;
      const containerWidth = el.clientWidth;

      // Update cached widths for any action buttons currently in the DOM
      const children = Array.from(el.children).filter(
        (c) => !c.hasAttribute("data-overflow-trigger"),
      ) as HTMLElement[];
      for (let i = 0; i < children.length; i++) {
        const w = children[i]!.offsetWidth;
        if (w > 0) widthsRef.current[i] = w;
      }

      // Pass 1: check if ALL actions fit without any overflow trigger
      let totalWidth = 0;
      let allMeasured = true;
      for (let i = 0; i < actions.length; i++) {
        const w = widthsRef.current[i];
        if (w === undefined) {
          allMeasured = false;
          break;
        }
        totalWidth += w + (i > 0 ? GAP : 0);
      }

      if (allMeasured && totalWidth <= containerWidth) {
        // Everything fits — no overflow trigger needed
        setVisibleCount(actions.length);
        return;
      }

      // Pass 2: not all fit (or not all measured) — reserve space for trigger + gap
      const budget = containerWidth - TRIGGER_WIDTH - GAP;
      let usedWidth = 0;
      let count = 0;
      for (let i = 0; i < actions.length; i++) {
        const w = widthsRef.current[i];
        if (w === undefined) {
          // Not yet measured — assume it fits (will be measured on next render)
          needsRemeasureRef.current = true;
          count++;
          continue;
        }
        const needed = usedWidth + w + (count > 0 ? GAP : 0);
        if (needed > budget) break;
        usedWidth = needed;
        count++;
      }
      setVisibleCount(count || 1);
    }

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [actions]);

  // Correction pass: after the [actions] effect optimistically shows all buttons
  // (because some widths were unknown), this effect runs on the subsequent render
  // when all buttons are in the DOM and measures them accurately.
  // Keyed on [visibleCount]: runs whenever visibleCount changes (including when
  // the [actions] effect sets it to actions.length). On that render the DOM has
  // all buttons visible, so we can measure them all and compute the correct count.
  // Both effects are useLayoutEffect so no visible flash.
  useLayoutEffect(() => {
    if (!needsRemeasureRef.current) return;
    const el = containerRef.current;
    if (!el) return;

    const GAP = 6;

    // Populate widths from the now-rendered DOM children
    const children = Array.from(el.children).filter(
      (c) => !c.hasAttribute("data-overflow-trigger"),
    ) as HTMLElement[];

    // If the DOM doesn't yet have all buttons, wait for the next render
    if (children.length < actions.length) return;

    // All buttons are in the DOM — clear the flag and measure accurately
    needsRemeasureRef.current = false;

    for (let i = 0; i < children.length; i++) {
      const w = children[i]!.offsetWidth;
      if (w > 0) widthsRef.current[i] = w;
    }

    const containerWidth = el.clientWidth;

    // Pass 1: check if all fit without trigger
    let totalWidth = 0;
    let allMeasured = true;
    for (let i = 0; i < actions.length; i++) {
      const w = widthsRef.current[i];
      if (w === undefined) {
        allMeasured = false;
        break;
      }
      totalWidth += w + (i > 0 ? GAP : 0);
    }
    if (allMeasured && totalWidth <= containerWidth) {
      setVisibleCount(actions.length);
      return;
    }

    // Pass 2: reserve trigger + gap
    const budget = containerWidth - TRIGGER_WIDTH - GAP;
    let usedWidth = 0;
    let count = 0;
    for (let i = 0; i < actions.length; i++) {
      const w = widthsRef.current[i];
      if (w === undefined) {
        count++;
        continue;
      }
      const needed = usedWidth + w + (count > 0 ? GAP : 0);
      if (needed > budget) break;
      usedWidth = needed;
      count++;
    }
    setVisibleCount(count || 1);
  }, [visibleCount, actions]);

  const hasOverflow = visibleCount < actions.length;

  return (
    <div
      ref={containerRef}
      className="mt-2 flex flex-nowrap items-center gap-1.5"
      style={{ overflow: "hidden" }}
      data-bib-actions
    >
      {actions.slice(0, visibleCount).map((a) => (
        <ActionButton key={a.key} action={a} />
      ))}
      {hasOverflow && (
        <>
          <button
            ref={triggerRef}
            data-overflow-trigger
            onClick={() => setOpen((v) => !v)}
            aria-label="More actions"
            className="inline-flex items-center justify-center rounded border border-border px-1.5 py-0.5 text-xs text-text-muted hover:bg-bg-hover"
          >
            ⋮
          </button>
          {open && createPortal(
            <div
              ref={menuRef}
              data-testid="bib-overflow-menu"
              style={{ position: "fixed", left: 0, top: 0 }}
              className="z-50 min-w-[140px] select-none rounded-lg border border-border/20 bg-bg-primary/80 p-1 shadow-lg shadow-black/10 backdrop-blur-xl backdrop-saturate-150 dark:border-border/10 dark:bg-bg-primary/70"
            >
              {actions.slice(visibleCount).map((a) => (
                <button
                  key={a.key}
                  data-testid={a.testId}
                  disabled={a.disabled}
                  onClick={() => {
                    setOpen(false);
                    a.onClick();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-1 text-start text-[13px] text-text-normal hover:bg-interactive-accent hover:text-text-on-accent disabled:opacity-50"
                >
                  {a.spinner
                    ? <SpinnerSvg className="h-3 w-3" />
                    : <span className="nerd-font" aria-hidden="true">{a.icon}</span>}
                  <span>{a.label}</span>
                </button>
              ))}
            </div>,
            document.body,
          )}
        </>
      )}
    </div>
  );
}

/** @internal exported for testing only */
export function ActionButton({ action: a }: { action: BibActionDescriptor }) {
  return (
    <button
      data-testid={a.testId}
      disabled={a.disabled}
      onClick={a.onClick}
      title={a.title ?? a.label}
      aria-label={a.label}
      className={BUTTON_CLASS + (a.renderContent ? " gap-1" : "")}
    >
      {a.spinner
        ? <><SpinnerSvg className="h-3 w-3" />{a.renderContent}</>
        : <span className="nerd-font" aria-hidden="true">{a.icon}</span>}
    </button>
  );
}

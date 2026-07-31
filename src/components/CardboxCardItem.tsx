import { memo, useCallback } from "react";
import { CardboxCard } from "./CardboxCard";
import { useMasonryRef } from "../hooks/useMasonryObserver";
import { useSelectionClickCapture } from "../hooks/useSelectionClickCapture";
import { useCardboxSelectionStore } from "../stores/cardboxSelection";
import type { CardboxAnnotation } from "../lib/ipc";

interface CardboxCardItemProps {
  annotation: CardboxAnnotation;
  expanded: boolean;
  isPinned?: boolean;
  colorTag?: string;
  onToggleExpand: (uuid: string) => void;
  onNavigate: (ann: CardboxAnnotation) => void;
  linkedCards?: CardboxAnnotation[];
  onFocusCard?: (uuid: string, highlightNote?: boolean) => void;
  onRemoveLink?: (targetUuid: string) => void;
  onShowConnections?: (uuid: string) => void;
  onContextMenu?: (uuid: string, e: React.MouseEvent) => void;
  note?: string;
  notePrefill?: string;
  onNotePrefillConsumed?: () => void;
  onSetNote?: (uuid: string, body: string) => void;
  onExportNote?: (uuid: string) => void;
  onSelect?: (uuid: string, event: React.MouseEvent) => void;
}

export const CardboxCardItem = memo(function CardboxCardItem({ annotation, expanded, isPinned, colorTag, onToggleExpand, onNavigate, linkedCards, onFocusCard, onRemoveLink, onShowConnections, onContextMenu, note, notePrefill, onNotePrefillConsumed, onSetNote, onExportNote, onSelect }: CardboxCardItemProps) {
  const isSelected = useCardboxSelectionStore((s) => s.selectedUuids.has(annotation.uuid));

  const masonryRef = useMasonryRef();

  const handleClickCapture = useSelectionClickCapture(annotation.uuid, onSelect);

  const handleToggleExpand = useCallback(() => onToggleExpand(annotation.uuid), [onToggleExpand, annotation.uuid]);
  const handleNavigate = useCallback(() => onNavigate(annotation), [onNavigate, annotation]);
  const handleShowConnections = useCallback(() => onShowConnections?.(annotation.uuid), [onShowConnections, annotation.uuid]);
  const handleContextMenu = useCallback((e: React.MouseEvent) => onContextMenu?.(annotation.uuid, e), [onContextMenu, annotation.uuid]);
  const handleSetNote = useCallback((body: string) => onSetNote?.(annotation.uuid, body), [onSetNote, annotation.uuid]);
  const handleExportNote = useCallback(() => onExportNote?.(annotation.uuid), [onExportNote, annotation.uuid]);

  const style: React.CSSProperties = {
    gridRowEnd: "span 1",
    zIndex: expanded ? 10 : undefined,
    position: expanded ? "relative" : undefined,
  };

  return (
    <div
      style={style}
      onContextMenu={handleContextMenu}
      onClickCapture={handleClickCapture}
    >
      <div ref={masonryRef} data-masonry-content="">
        <CardboxCard
          annotation={annotation}
          expanded={expanded}
          isPinned={isPinned}
          isSelected={isSelected}
          colorTag={colorTag}
          onToggleExpand={handleToggleExpand}
          onNavigate={handleNavigate}
          linkedCards={linkedCards}
          onFocusCard={onFocusCard}
          onRemoveLink={onRemoveLink}
          note={note}
          notePrefill={notePrefill}
          onNotePrefillConsumed={onNotePrefillConsumed}
          onSetNote={handleSetNote}
          onExportNote={handleExportNote}
          onShowConnections={handleShowConnections}
        />
      </div>
    </div>
  );
});

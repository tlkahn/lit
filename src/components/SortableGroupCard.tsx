import { memo, useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CardboxCard } from "./CardboxCard";
import { useMasonryRef } from "../hooks/useMasonryObserver";
import { useSelectionClickCapture } from "../hooks/useSelectionClickCapture";
import { useDraggedUuids } from "./DraggedUuidsContext";
import { makeGroupCardId } from "../lib/dndIds";
import { useCardboxSelectionStore } from "../stores/cardboxSelection";
import type { CardboxAnnotation } from "../lib/ipc";

interface SortableGroupCardProps {
  groupId: string;
  annotation: CardboxAnnotation;
  expanded: boolean;
  colorTag?: string;
  onToggleExpand: (uuid: string) => void;
  onNavigate: (ann: CardboxAnnotation) => void;
  linkedCards?: CardboxAnnotation[];
  onFocusCard?: (uuid: string) => void;
  onRemoveLink?: (targetUuid: string) => void;
  onShowConnections?: (uuid: string) => void;
  onContextMenu?: (uuid: string, e: React.MouseEvent) => void;
  note?: string;
  onSetNote?: (uuid: string, body: string) => void;
  onExportNote?: (uuid: string) => void;
  onSelect?: (uuid: string, event: React.MouseEvent) => void;
}

export const SortableGroupCard = memo(function SortableGroupCard({
  groupId,
  annotation,
  expanded,
  colorTag,
  onToggleExpand,
  onNavigate,
  linkedCards,
  onFocusCard,
  onRemoveLink,
  onShowConnections,
  onContextMenu,
  note,
  onSetNote,
  onExportNote,
  onSelect,
}: SortableGroupCardProps) {
  const isSelected = useCardboxSelectionStore((s) => s.selectedUuids.has(annotation.uuid));
  const draggedUuids = useDraggedUuids();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: makeGroupCardId(groupId, annotation.uuid) });

  const isGhostDragged = draggedUuids.has(annotation.uuid) && !isDragging;

  const masonryRef = useMasonryRef();

  const handleClickCapture = useSelectionClickCapture(annotation.uuid, onSelect);

  const handleToggleExpand = useCallback(() => onToggleExpand(annotation.uuid), [onToggleExpand, annotation.uuid]);
  const handleNavigate = useCallback(() => onNavigate(annotation), [onNavigate, annotation]);
  const handleShowConnections = useCallback(() => onShowConnections?.(annotation.uuid), [onShowConnections, annotation.uuid]);
  const handleContextMenu = useCallback((e: React.MouseEvent) => onContextMenu?.(annotation.uuid, e), [onContextMenu, annotation.uuid]);
  const handleSetNote = useCallback((body: string) => onSetNote?.(annotation.uuid, body), [onSetNote, annotation.uuid]);
  const handleExportNote = useCallback(() => onExportNote?.(annotation.uuid), [onExportNote, annotation.uuid]);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.4 : isGhostDragged ? 0.3 : 1,
    gridRowEnd: "span 1",
    zIndex: expanded ? 10 : undefined,
    position: expanded ? "relative" : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        isDragging ? "rounded-lg border-2 border-dashed border-border"
        : isGhostDragged ? "rounded-lg border-2 border-dashed border-interactive-accent"
        : ""
      }
      {...attributes}
      {...listeners}
      onContextMenu={handleContextMenu}
      onClickCapture={handleClickCapture}
    >
      <div ref={masonryRef} data-masonry-content="">
        <CardboxCard
          annotation={annotation}
          expanded={expanded}
          isSelected={isSelected}
          colorTag={colorTag}
          onToggleExpand={handleToggleExpand}
          onNavigate={handleNavigate}
          linkedCards={linkedCards}
          onFocusCard={onFocusCard}
          onRemoveLink={onRemoveLink}
          note={note}
          onSetNote={handleSetNote}
          onExportNote={handleExportNote}
          onShowConnections={handleShowConnections}
        />
      </div>
    </div>
  );
});

import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CardboxCard } from "./CardboxCard";
import { CARD_HEIGHT } from "../lib/cardConstants";
import { useSelectionClickCapture } from "../hooks/useSelectionClickCapture";
import { useDraggedUuids } from "./DraggedUuidsContext";
import { useCardboxSelectionStore } from "../stores/cardboxSelection";
import type { CardboxAnnotation } from "../lib/ipc";

interface SortableCardProps {
  annotation: CardboxAnnotation;
  expanded: boolean;
  isPinned?: boolean;
  colorTag?: string;
  onToggleExpand: () => void;
  onNavigate: () => void;
  linkedCards?: CardboxAnnotation[];
  onFocusCard?: (uuid: string) => void;
  onRemoveLink?: (targetUuid: string) => void;
  onShowConnections?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  note?: string;
  onSetNote?: (body: string) => void;
  onExportNote?: () => void;
  onSelect?: (uuid: string, event: React.MouseEvent) => void;
}

export const SortableCard = memo(function SortableCard({ annotation, expanded, isPinned, colorTag, onToggleExpand, onNavigate, linkedCards, onFocusCard, onRemoveLink, onShowConnections, onContextMenu, note, onSetNote, onExportNote, onSelect }: SortableCardProps) {
  const isSelected = useCardboxSelectionStore((s) => s.selectedUuids.has(annotation.uuid));
  const draggedUuids = useDraggedUuids();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: annotation.uuid });

  const isGhostDragged = draggedUuids.has(annotation.uuid) && !isDragging;

  const handleClickCapture = useSelectionClickCapture(annotation.uuid, onSelect);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.4 : isGhostDragged ? 0.3 : 1,
    height: CARD_HEIGHT,
    overflow: "visible",
    position: "relative",
    zIndex: expanded ? 10 : undefined,
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
      onContextMenu={onContextMenu}
      onClickCapture={handleClickCapture}
    >
      <CardboxCard
        annotation={annotation}
        expanded={expanded}
        isPinned={isPinned}
        isSelected={isSelected}
        colorTag={colorTag}
        onToggleExpand={onToggleExpand}
        onNavigate={onNavigate}
        linkedCards={linkedCards}
        onFocusCard={onFocusCard}
        onRemoveLink={onRemoveLink}
        note={note}
        onSetNote={onSetNote}
        onExportNote={onExportNote}
        onShowConnections={onShowConnections}
      />
    </div>
  );
});

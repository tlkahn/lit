import { memo, useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CardboxCard } from "./CardboxCard";
import { useMasonrySpan } from "../hooks/useMasonrySpan";
import type { CardboxAnnotation } from "../lib/ipc";

interface SortableCardProps {
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
  onShowConnections?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  note?: string;
  onSetNote?: (body: string) => void;
  onExportNote?: () => void;
  onSelect?: (uuid: string, event: React.MouseEvent) => void;
}

export const SortableCard = memo(function SortableCard({ annotation, expanded, isPinned, isSelected, colorTag, onToggleExpand, onNavigate, linkedCards, onFocusCard, onRemoveLink, onShowConnections, onContextMenu, note, onSetNote, onExportNote, onSelect }: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: annotation.uuid });

  const { contentRef, span } = useMasonrySpan();

  const handleClickCapture = useCallback(
    (e: React.MouseEvent) => {
      if ((e.metaKey || e.ctrlKey || e.shiftKey) && onSelect) {
        e.stopPropagation();
        onSelect(annotation.uuid, e);
      }
    },
    [annotation.uuid, onSelect],
  );

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.4 : 1,
    gridRowEnd: `span ${span}`,
    zIndex: expanded ? 10 : undefined,
    position: expanded ? "relative" : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "rounded-lg border-2 border-dashed border-border" : ""}
      {...attributes}
      {...listeners}
      onContextMenu={onContextMenu}
      onClickCapture={handleClickCapture}
    >
      <div ref={contentRef} data-masonry-content="">
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
    </div>
  );
});

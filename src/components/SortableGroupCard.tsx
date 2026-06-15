import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CardboxCard } from "./CardboxCard";
import { useMasonrySpan } from "../hooks/useMasonrySpan";
import { makeGroupCardId } from "../lib/dndIds";
import type { CardboxAnnotation } from "../lib/ipc";

interface SortableGroupCardProps {
  groupId: string;
  annotation: CardboxAnnotation;
  expanded: boolean;
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
}: SortableGroupCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: makeGroupCardId(groupId, annotation.uuid) });

  const { contentRef, span } = useMasonrySpan();

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
    >
      <div ref={contentRef} data-masonry-content="">
        <CardboxCard
          annotation={annotation}
          expanded={expanded}
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

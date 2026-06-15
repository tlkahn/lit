import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CardboxCard } from "./CardboxCard";
import { useMasonrySpan } from "../hooks/useMasonrySpan";
import type { CardboxAnnotation } from "../lib/ipc";

interface SortableCardProps {
  annotation: CardboxAnnotation;
  expanded: boolean;
  isPinned?: boolean;
  onToggleExpand: () => void;
  onNavigate: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  linkedCards?: CardboxAnnotation[];
  onFocusCard?: (uuid: string) => void;
  onRemoveLink?: (targetUuid: string) => void;
}

export const SortableCard = memo(function SortableCard({ annotation, expanded, isPinned, onToggleExpand, onNavigate, onContextMenu, linkedCards, onFocusCard, onRemoveLink }: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: annotation.uuid });

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
      onContextMenu={onContextMenu}
      {...attributes}
      {...listeners}
    >
      <div ref={contentRef} data-masonry-content="">
        <CardboxCard
          annotation={annotation}
          expanded={expanded}
          isPinned={isPinned}
          onToggleExpand={onToggleExpand}
          onNavigate={onNavigate}
          linkedCards={linkedCards}
          onFocusCard={onFocusCard}
          onRemoveLink={onRemoveLink}
        />
      </div>
    </div>
  );
});

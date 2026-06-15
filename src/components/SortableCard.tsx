import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CardboxCard } from "./CardboxCard";
import type { CardboxAnnotation } from "../lib/ipc";

interface SortableCardProps {
  annotation: CardboxAnnotation;
  expanded: boolean;
  onToggleExpand: () => void;
  onNavigate: () => void;
}

export function SortableCard({ annotation, expanded, onToggleExpand, onNavigate }: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: annotation.uuid });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? "transform 200ms ease-out",
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "rounded-lg border-2 border-dashed border-border" : ""}
      {...attributes}
      {...listeners}
    >
      <CardboxCard
        annotation={annotation}
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        onNavigate={onNavigate}
      />
    </div>
  );
}

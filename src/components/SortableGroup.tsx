import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GroupHeader } from "./GroupHeader";
import { CardboxCard } from "./CardboxCard";
import { useMasonrySpan } from "../hooks/useMasonrySpan";
import type { CardboxAnnotation } from "../lib/ipc";
import type { GroupInfo } from "../lib/ipc";

const EMPTY_LINKED: CardboxAnnotation[] = [];

interface SortableGroupProps {
  groupId: string;
  info: GroupInfo;
  cards: CardboxAnnotation[];
  allFilteredCount: number;
  expandedUuid: string | null;
  linkedCardsMap: Map<string, CardboxAnnotation[]>;
  onToggleExpand: (uuid: string) => void;
  onNavigate: (ann: CardboxAnnotation) => void;
  onFocusCard: (uuid: string) => void;
  onRemoveLink: (targetUuid: string) => void;
  onToggleCollapse: () => void;
  onRename: (name: string) => void;
}

export const SortableGroup = memo(function SortableGroup({
  groupId,
  info,
  cards,
  allFilteredCount,
  expandedUuid,
  linkedCardsMap,
  onToggleExpand,
  onNavigate,
  onFocusCard,
  onRemoveLink,
  onToggleCollapse,
  onRename,
}: SortableGroupProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `group:${groupId}` });

  const { contentRef, span } = useMasonrySpan();

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.4 : 1,
    gridColumn: "1 / -1",
    gridRowEnd: `span ${span}`,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="cardbox-group"
      data-group-id={groupId}
      {...attributes}
      {...listeners}
    >
      <div ref={contentRef} data-masonry-content="">
        <div className="cardbox-group-container">
          <GroupHeader
            name={info.name}
            cardCount={cards.length}
            totalCount={allFilteredCount}
            collapsed={info.collapsed}
            onToggleCollapse={onToggleCollapse}
            onRename={onRename}
          />

          {!info.collapsed && (
            <div
              className="grid"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gridAutoRows: "8px",
                columnGap: "1rem",
                padding: "0 12px 12px 12px",
                alignItems: "start",
              }}
            >
              {cards.map((ann) => (
                <CardboxCard
                  key={ann.uuid}
                  annotation={ann}
                  expanded={expandedUuid === ann.uuid}
                  onToggleExpand={() => onToggleExpand(ann.uuid)}
                  onNavigate={() => onNavigate(ann)}
                  linkedCards={linkedCardsMap.get(ann.uuid) ?? EMPTY_LINKED}
                  onFocusCard={onFocusCard}
                  onRemoveLink={onRemoveLink}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

import { memo, useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { LazyMotion, domAnimation, m, AnimatePresence } from "framer-motion";
import { GroupHeader } from "./GroupHeader";
import { SortableGroupCard } from "./SortableGroupCard";
import { useMasonrySpan } from "../hooks/useMasonrySpan";
import { makeGroupCardId, makeDroppableGroupId } from "../lib/dndIds";
import type { CardboxAnnotation } from "../lib/ipc";
import type { GroupInfo, CardNote } from "../lib/ipc";

const EMPTY_LINKED: CardboxAnnotation[] = [];

interface SortableGroupProps {
  groupId: string;
  info: GroupInfo;
  cards: CardboxAnnotation[];
  allFilteredCount: number;
  expandedUuid: string | null;
  linkedCardsMap: Map<string, CardboxAnnotation[]>;
  notesMap?: Record<string, CardNote>;
  isDropTarget?: boolean;
  onToggleExpand: (uuid: string) => void;
  onNavigate: (ann: CardboxAnnotation) => void;
  onFocusCard: (uuid: string) => void;
  onRemoveLink: (targetUuid: string) => void;
  onSetNote?: (uuid: string, body: string) => void;
  onExportNote?: (uuid: string) => void;
  onToggleCollapse: () => void;
  onRename: (name: string) => void;
  onShowConnections?: (uuid: string) => void;
  onCardContextMenu?: (cardUuid: string, e: React.MouseEvent) => void;
  onHeaderContextMenu?: (e: React.MouseEvent) => void;
  colors?: Record<string, string>;
  onCardSelect?: (uuid: string, event: React.MouseEvent) => void;
}

export const SortableGroup = memo(function SortableGroup({
  groupId,
  info,
  cards,
  allFilteredCount,
  expandedUuid,
  linkedCardsMap,
  notesMap,
  isDropTarget,
  onToggleExpand,
  onNavigate,
  onFocusCard,
  onRemoveLink,
  onSetNote,
  onExportNote,
  onToggleCollapse,
  onRename,
  onShowConnections,
  onCardContextMenu,
  onHeaderContextMenu,
  colors,
  onCardSelect,
}: SortableGroupProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `group:${groupId}` });

  const { setNodeRef: setDroppableRef } = useDroppable({
    id: makeDroppableGroupId(groupId),
  });

  // Merge sortable + droppable refs onto the same DOM node
  const mergedRef = useCallback(
    (node: HTMLElement | null) => {
      setSortableRef(node);
      setDroppableRef(node);
    },
    [setSortableRef, setDroppableRef],
  );

  const { contentRef, span } = useMasonrySpan();

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.4 : 1,
    gridColumn: "1 / -1",
    gridRowEnd: `span ${span}`,
  };

  const groupCardIds = cards.map((ann) => makeGroupCardId(groupId, ann.uuid));

  return (
    <div
      ref={mergedRef}
      style={style}
      data-testid="cardbox-group"
      data-group-id={groupId}
      {...attributes}
      {...listeners}
    >
      <div ref={contentRef} data-masonry-content="">
        <div
          className="cardbox-group-container"
          data-drag-over={isDropTarget ? "true" : undefined}
        >
          <GroupHeader
            name={info.name}
            cardCount={cards.length}
            totalCount={allFilteredCount}
            collapsed={info.collapsed}
            onToggleCollapse={onToggleCollapse}
            onRename={onRename}
            onContextMenu={onHeaderContextMenu}
          />

          <LazyMotion features={domAnimation}>
            <AnimatePresence initial={false}>
              {!info.collapsed && (
                <m.div
                  key="group-cards"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  style={{ overflow: "hidden" }}
                >
                  <SortableContext
                    items={groupCardIds}
                    strategy={rectSortingStrategy}
                  >
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
                        <SortableGroupCard
                          key={ann.uuid}
                          groupId={groupId}
                          annotation={ann}
                          expanded={expandedUuid === ann.uuid}
                          colorTag={colors?.[ann.uuid]}
                          onToggleExpand={() => onToggleExpand(ann.uuid)}
                          onNavigate={() => onNavigate(ann)}
                          linkedCards={linkedCardsMap.get(ann.uuid) ?? EMPTY_LINKED}
                          onFocusCard={onFocusCard}
                          onRemoveLink={onRemoveLink}
                          note={notesMap?.[ann.uuid]?.body}
                          onSetNote={onSetNote ? (body: string) => onSetNote(ann.uuid, body) : undefined}
                          onExportNote={onExportNote ? () => onExportNote(ann.uuid) : undefined}
                          onShowConnections={() => onShowConnections?.(ann.uuid)}
                          onContextMenu={(e) => onCardContextMenu?.(ann.uuid, e)}
                          onSelect={onCardSelect}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </m.div>
              )}
            </AnimatePresence>
          </LazyMotion>
        </div>
      </div>
    </div>
  );
});

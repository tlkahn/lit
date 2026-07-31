import { memo, useCallback } from "react";
import { LazyMotion, domAnimation, m, AnimatePresence } from "framer-motion";
import { GroupHeader } from "./GroupHeader";
import { CardboxGroupCardItem } from "./CardboxGroupCardItem";
import { useMasonryRef } from "../hooks/useMasonryObserver";
import type { CardboxAnnotation } from "../lib/ipc";
import type { GroupInfo, CardNote } from "../lib/ipc";

const EMPTY_LINKED: CardboxAnnotation[] = [];

interface CardboxGroupProps {
  groupId: string;
  info: GroupInfo;
  cards: CardboxAnnotation[];
  allFilteredCount: number;
  expandedUuid: string | null;
  linkedCardsMap: Map<string, CardboxAnnotation[]>;
  notesMap?: Record<string, CardNote>;
  notePrefill?: { uuid: string; text: string } | null;
  onNotePrefillConsumed?: () => void;
  onToggleExpand: (uuid: string) => void;
  onNavigate: (ann: CardboxAnnotation) => void;
  onFocusCard: (uuid: string, highlightNote?: boolean) => void;
  onRemoveLink: (targetUuid: string) => void;
  onSetNote?: (uuid: string, body: string) => void;
  onExportNote?: (uuid: string) => void;
  onToggleCollapse: (groupId: string) => void;
  onRename: (groupId: string, name: string) => void;
  onShowConnections?: (uuid: string) => void;
  onCardContextMenu?: (groupId: string, cardUuid: string, e: React.MouseEvent) => void;
  onHeaderContextMenu?: (groupId: string, e: React.MouseEvent) => void;
  colors?: Record<string, string>;
  onCardSelect?: (uuid: string, event: React.MouseEvent) => void;
}

export const CardboxGroup = memo(function CardboxGroup({
  groupId,
  info,
  cards,
  allFilteredCount,
  expandedUuid,
  linkedCardsMap,
  notesMap,
  notePrefill,
  onNotePrefillConsumed,
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
}: CardboxGroupProps) {
  const masonryRef = useMasonryRef();

  const handleToggleCollapse = useCallback(() => onToggleCollapse(groupId), [onToggleCollapse, groupId]);
  const handleRename = useCallback((name: string) => onRename(groupId, name), [onRename, groupId]);
  const handleCardContextMenu = useCallback(
    (cardUuid: string, e: React.MouseEvent) => onCardContextMenu?.(groupId, cardUuid, e),
    [onCardContextMenu, groupId],
  );
  const handleHeaderContextMenu = useCallback(
    (e: React.MouseEvent) => onHeaderContextMenu?.(groupId, e),
    [onHeaderContextMenu, groupId],
  );

  const style: React.CSSProperties = {
    gridColumn: "1 / -1",
    gridRowEnd: "span 1",
  };

  return (
    <div
      style={style}
      data-testid="cardbox-group"
      data-group-id={groupId}
    >
      <div ref={masonryRef} data-masonry-content="">
        <div className="cardbox-group-container">
          <GroupHeader
            name={info.name}
            cardCount={cards.length}
            totalCount={allFilteredCount}
            collapsed={info.collapsed}
            onToggleCollapse={handleToggleCollapse}
            onRename={handleRename}
            onContextMenu={handleHeaderContextMenu}
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
                      <CardboxGroupCardItem
                        key={ann.uuid}
                        groupId={groupId}
                        annotation={ann}
                        expanded={expandedUuid === ann.uuid}
                        colorTag={colors?.[ann.uuid]}
                        onToggleExpand={onToggleExpand}
                        onNavigate={onNavigate}
                        linkedCards={linkedCardsMap.get(ann.uuid) ?? EMPTY_LINKED}
                        onFocusCard={onFocusCard}
                        onRemoveLink={onRemoveLink}
                        note={notesMap?.[ann.uuid]?.body}
                        notePrefill={notePrefill?.uuid === ann.uuid ? notePrefill.text : undefined}
                        onNotePrefillConsumed={onNotePrefillConsumed}
                        onSetNote={onSetNote}
                        onExportNote={onExportNote}
                        onShowConnections={onShowConnections}
                        onContextMenu={handleCardContextMenu}
                        onSelect={onCardSelect}
                      />
                    ))}
                  </div>
                </m.div>
              )}
            </AnimatePresence>
          </LazyMotion>
        </div>
      </div>
    </div>
  );
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { SortableGroup } from "./SortableGroup";
import { useCardboxSelectionStore } from "../stores/cardboxSelection";
import type { CardboxAnnotation, GroupInfo } from "../lib/ipc";
import type { ReactNode } from "react";

function makeAnnotation(uuid: string): CardboxAnnotation {
  return {
    uuid,
    annotation_type: "note",
    certainty: "neutral",
    body: `Body of ${uuid}`,
    date: "2026-06-15",
    source_page_id: "test.md",
    source_page_title: "Test Document",
    source_line: 5,
    char_start: 10,
    char_end: 50,
    scope_kind: "words",
    scope_value: "1",
    original: "The original source context text here",
  };
}

const cardA = makeAnnotation("card-a");
const cardB = makeAnnotation("card-b");

const baseInfo: GroupInfo = { name: "My Group", order: ["card-a", "card-b"], collapsed: false };

// Temporary dnd wrapper: deleted along with the dnd wiring in Phase B (#968).
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <DndContext>
      <SortableContext items={["group:g1"]}>{children}</SortableContext>
    </DndContext>
  );
}

function renderGroup(props: Partial<React.ComponentProps<typeof SortableGroup>> = {}) {
  return render(
    <Wrapper>
      <SortableGroup
        groupId="g1"
        info={baseInfo}
        cards={[cardA, cardB]}
        allFilteredCount={2}
        expandedUuid={null}
        linkedCardsMap={new Map()}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        onFocusCard={() => {}}
        onRemoveLink={() => {}}
        onToggleCollapse={() => {}}
        onRename={() => {}}
        {...props}
      />
    </Wrapper>,
  );
}

beforeEach(() => {
  useCardboxSelectionStore.setState({ selectedUuids: new Set(), lastSelectedUuid: null });
});

describe("SortableGroup", () => {
  it("renders the group container with its group id", () => {
    renderGroup();
    const group = screen.getByTestId("cardbox-group");
    expect(group).toHaveAttribute("data-group-id", "g1");
  });

  it("renders the masonry content div nested inside a full-width grid item", () => {
    renderGroup();
    const group = screen.getByTestId("cardbox-group");
    expect(group.style.gridColumn).toBe("1 / -1");
    expect(group.style.gridRowEnd).toBe("span 1");
    const masonryContent = group.firstElementChild;
    expect(masonryContent).toHaveAttribute("data-masonry-content");
  });

  it("renders member cards when not collapsed", () => {
    renderGroup();
    const cards = screen.getAllByTestId("cardbox-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute("data-uuid", "card-a");
    expect(cards[1]).toHaveAttribute("data-uuid", "card-b");
  });

  it("hides member cards when collapsed", () => {
    renderGroup({ info: { ...baseInfo, collapsed: true } });
    expect(screen.queryAllByTestId("cardbox-card")).toHaveLength(0);
  });

  it("calls onToggleCollapse with the group id when the chevron is clicked", () => {
    const onToggleCollapse = vi.fn();
    renderGroup({ onToggleCollapse });
    fireEvent.click(screen.getByTestId("group-collapse-toggle"));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    expect(onToggleCollapse).toHaveBeenCalledWith("g1");
  });

  it("forwards a header contextmenu with the group id", () => {
    const onHeaderContextMenu = vi.fn();
    renderGroup({ onHeaderContextMenu });
    fireEvent.contextMenu(screen.getByTestId("group-header"));
    expect(onHeaderContextMenu).toHaveBeenCalledTimes(1);
    expect(onHeaderContextMenu).toHaveBeenCalledWith("g1", expect.anything());
  });

  it("forwards a member card contextmenu with group and card ids", () => {
    const onCardContextMenu = vi.fn();
    renderGroup({ onCardContextMenu });
    const cards = screen.getAllByTestId("cardbox-card");
    fireEvent.contextMenu(cards[1]!);
    expect(onCardContextMenu).toHaveBeenCalledTimes(1);
    expect(onCardContextMenu).toHaveBeenCalledWith("g1", "card-b", expect.anything());
  });
});

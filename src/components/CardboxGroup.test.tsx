import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CardboxGroup } from "./CardboxGroup";
import { useCardboxSelectionStore } from "../stores/cardboxSelection";
import type { CardboxAnnotation, GroupInfo } from "../lib/ipc";

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

function renderGroup(props: Partial<React.ComponentProps<typeof CardboxGroup>> = {}) {
  return render(
    <CardboxGroup
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
    />,
  );
}

beforeEach(() => {
  useCardboxSelectionStore.setState({ selectedUuids: new Set(), lastSelectedUuid: null });
});

describe("CardboxGroup", () => {
  it("renders the group container with its group id", () => {
    renderGroup();
    const group = screen.getByTestId("cardbox-group");
    expect(group).toHaveAttribute("data-group-id", "g1");
  });

  it("stamps data-collapsed so keyboard nav can skip exit-animating cards", () => {
    renderGroup();
    expect(screen.getByTestId("cardbox-group")).toHaveAttribute("data-collapsed", "false");
    renderGroup({ info: { ...baseInfo, collapsed: true } });
    const groups = screen.getAllByTestId("cardbox-group");
    expect(groups[groups.length - 1]).toHaveAttribute("data-collapsed", "true");
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

  it("never renders data-drag-over", () => {
    const { container } = renderGroup();
    expect(container.querySelector("[data-drag-over]")).toBeNull();
  });

  it("renders no drag transform and no dnd attributes on the group wrapper", () => {
    renderGroup();
    const group = screen.getByTestId("cardbox-group");
    expect(group).not.toHaveAttribute("role");
    expect(group).not.toHaveAttribute("aria-roledescription");
    expect(group).not.toHaveAttribute("aria-describedby");
    expect(group.style.transform).toBe("");
  });

  it("keeps the collapse animation wrapper around the member grid", () => {
    renderGroup();
    const grid = screen.getAllByTestId("cardbox-card")[0]!.closest(".grid")!;
    // framer-motion's height-collapse wrapper must survive the dnd removal
    expect((grid.parentElement as HTMLElement).style.overflow).toBe("hidden");
  });
});

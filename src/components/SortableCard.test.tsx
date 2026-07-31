import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { SortableCard } from "./SortableCard";
import { useCardboxSelectionStore } from "../stores/cardboxSelection";
import type { CardboxAnnotation } from "../lib/ipc";
import type { ReactNode } from "react";

const baseAnnotation: CardboxAnnotation = {
  uuid: "card-uuid-1",
  annotation_type: "note",
  certainty: "neutral",
  body: "A card body",
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

// Temporary dnd wrapper: deleted along with the dnd wiring in Phase B (#968).
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <DndContext>
      <SortableContext items={[baseAnnotation.uuid]}>{children}</SortableContext>
    </DndContext>
  );
}

function renderCard(props: Partial<React.ComponentProps<typeof SortableCard>> = {}) {
  return render(
    <Wrapper>
      <SortableCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        {...props}
      />
    </Wrapper>,
  );
}

beforeEach(() => {
  useCardboxSelectionStore.setState({ selectedUuids: new Set(), lastSelectedUuid: null });
});

describe("SortableCard", () => {
  it("renders the masonry content div nested inside the grid item wrapper", () => {
    renderCard();
    const card = screen.getByTestId("cardbox-card");
    const masonryContent = card.parentElement;
    expect(masonryContent).toHaveAttribute("data-masonry-content");
    // useMasonryObserver writes gridRowEnd on parentElement of the observed
    // node, so the two-div nesting is load-bearing.
    const gridItem = masonryContent!.parentElement;
    expect(gridItem).not.toBeNull();
    expect(gridItem!.style.gridRowEnd).toBe("span 1");
  });

  it("forwards a cmd-click to onSelect without expanding", () => {
    const onSelect = vi.fn();
    const onToggleExpand = vi.fn();
    renderCard({ onSelect, onToggleExpand });
    fireEvent.click(screen.getByTestId("cardbox-card"), { metaKey: true });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(baseAnnotation.uuid, expect.anything());
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it("forwards a shift-click to onSelect without expanding", () => {
    const onSelect = vi.fn();
    const onToggleExpand = vi.fn();
    renderCard({ onSelect, onToggleExpand });
    fireEvent.click(screen.getByTestId("cardbox-card"), { shiftKey: true });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(baseAnnotation.uuid, expect.anything());
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it("does not call onSelect on a plain click", () => {
    const onSelect = vi.fn();
    renderCard({ onSelect });
    fireEvent.click(screen.getByTestId("cardbox-card"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("forwards contextmenu with the card uuid", () => {
    const onContextMenu = vi.fn();
    renderCard({ onContextMenu });
    fireEvent.contextMenu(screen.getByTestId("cardbox-card"));
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu).toHaveBeenCalledWith(baseAnnotation.uuid, expect.anything());
  });

  it("raises the grid item with zIndex 10 and relative positioning only when expanded", () => {
    const { unmount } = renderCard({ expanded: true });
    let gridItem = screen.getByTestId("cardbox-card").parentElement!.parentElement!;
    expect(gridItem.style.zIndex).toBe("10");
    expect(gridItem.style.position).toBe("relative");
    unmount();

    renderCard({ expanded: false });
    gridItem = screen.getByTestId("cardbox-card").parentElement!.parentElement!;
    expect(gridItem.style.zIndex).toBe("");
    expect(gridItem.style.position).toBe("");
  });

  it("reflects selection state from the selection store", () => {
    useCardboxSelectionStore.setState({
      selectedUuids: new Set([baseAnnotation.uuid]),
      lastSelectedUuid: baseAnnotation.uuid,
    });
    renderCard();
    expect(screen.getByTestId("cardbox-card").className).toContain("ring-offset-1");
  });

  it("does not mark an unselected card as selected", () => {
    renderCard();
    expect(screen.getByTestId("cardbox-card").className).not.toContain("ring-offset-1");
  });
});

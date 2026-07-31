import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GroupHeader } from "./GroupHeader";

function renderHeader(
  props: Partial<React.ComponentProps<typeof GroupHeader>> = {},
  onParentPointerDown?: (e: React.PointerEvent) => void,
) {
  return render(
    <div onPointerDown={onParentPointerDown}>
      <GroupHeader
        name="My Group"
        cardCount={2}
        totalCount={4}
        collapsed={false}
        onToggleCollapse={() => {}}
        onRename={() => {}}
        {...props}
      />
    </div>,
  );
}

describe("GroupHeader", () => {
  it("does not stop propagation of pointerdown on the header", () => {
    // Group titles must be text-selectable: a pointerdown that starts a text
    // selection has to reach ancestors untouched (#968).
    const onParentPointerDown = vi.fn();
    renderHeader({}, onParentPointerDown);
    fireEvent.pointerDown(screen.getByTestId("group-header"));
    expect(onParentPointerDown).toHaveBeenCalledTimes(1);
  });

  it("renders the group name and count", () => {
    renderHeader();
    expect(screen.getByTestId("group-name")).toHaveTextContent("My Group");
    expect(screen.getByTestId("group-card-count")).toHaveTextContent("2/4");
  });

  it("enters rename mode on double click and confirms with Enter", () => {
    const onRename = vi.fn();
    renderHeader({ onRename });
    fireEvent.doubleClick(screen.getByTestId("group-name"));
    const input = screen.getByTestId("group-name-input");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("Renamed");
  });
});

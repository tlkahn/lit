import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  describe("title text selection (#968)", () => {
    const indexCss = () => readFileSync(resolve(__dirname, "../index.css"), "utf8");

    /** The `#root ... { user-select: auto }` opt-in selector list. */
    const optInSelectors = () => {
      const match = indexCss().match(
        /((?:#root [^{}]+,\s*)*#root [^{},]+)\s*\{\s*user-select:\s*auto;/,
      );
      expect(match).not.toBeNull();
      return match![1]!;
    };

    it("index.css opts the group name into user-select auto", () => {
      expect(optInSelectors()).toMatch(/#root \.group-name/);
    });

    it("index.css gives the group name a text cursor", () => {
      const rule = indexCss().match(/\.group-name\s*\{[^}]*\}/);
      expect(rule).not.toBeNull();
      expect(rule![0]!).toContain("cursor: text");
    });
  });
});

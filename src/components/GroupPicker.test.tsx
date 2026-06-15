import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupPicker } from "./GroupPicker";
import type { GroupInfo } from "../lib/ipc";

const makeGroups = (
  ...entries: [string, string, string[]][]
): Record<string, GroupInfo> => {
  const groups: Record<string, GroupInfo> = {};
  for (const [id, name, order] of entries) {
    groups[id] = { name, order, collapsed: false };
  }
  return groups;
};

const noop = () => {};

describe("GroupPicker", () => {
  // Cycle 1: renders nothing when closed
  it("renders nothing when open is false", () => {
    const { container } = render(
      <GroupPicker open={false} groups={{}} onSelect={noop} onClose={noop} />,
    );
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Cycle 2: renders modal with group list when open
  it("renders a dialog with group items when open", () => {
    const groups = makeGroups(
      ["g1", "Alpha", ["x"]],
      ["g2", "Beta", ["y", "z"]],
    );
    render(<GroupPicker open={true} groups={groups} onSelect={noop} onClose={noop} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const items = screen.getAllByTestId("group-picker-item");
    expect(items).toHaveLength(2);
    expect(items[0]!).toHaveTextContent("Alpha");
    expect(items[0]!).toHaveTextContent("1 card");
    expect(items[1]!).toHaveTextContent("Beta");
    expect(items[1]!).toHaveTextContent("2 cards");
  });

  // Cycle 3: clicking a group calls onSelect + onClose
  it("calls onSelect and onClose when a group is clicked", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const groups = makeGroups(["g1", "Alpha", ["x"]], ["g2", "Beta", ["y"]]);

    render(<GroupPicker open={true} groups={groups} onSelect={onSelect} onClose={onClose} />);

    const items = screen.getAllByTestId("group-picker-item");
    await userEvent.click(items[0]!);

    expect(onSelect).toHaveBeenCalledWith("g1");
    expect(onClose).toHaveBeenCalled();
  });

  // Cycle 4: Escape closes the picker
  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    const groups = makeGroups(["g1", "Alpha", ["x"]]);

    render(<GroupPicker open={true} groups={groups} onSelect={noop} onClose={onClose} />);

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  // Cycle 5: backdrop click closes
  it("calls onClose when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    const groups = makeGroups(["g1", "Alpha", ["x"]]);

    render(<GroupPicker open={true} groups={groups} onSelect={noop} onClose={onClose} />);

    const backdrop = screen.getByTestId("group-picker-backdrop");
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close when the panel is clicked", async () => {
    const onClose = vi.fn();
    const groups = makeGroups(["g1", "Alpha", ["x"]]);

    render(<GroupPicker open={true} groups={groups} onSelect={noop} onClose={onClose} />);

    const panel = screen.getByTestId("group-picker-panel");
    await userEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
  });

  // Cycle 6: keyboard navigation
  it("supports ArrowDown/ArrowUp/Enter keyboard navigation", async () => {
    const onSelect = vi.fn();
    const groups = makeGroups(
      ["g1", "Alpha", ["x"]],
      ["g2", "Beta", ["y"]],
      ["g3", "Gamma", ["z"]],
    );

    render(<GroupPicker open={true} groups={groups} onSelect={onSelect} onClose={noop} />);

    // First item starts active
    const items = screen.getAllByTestId("group-picker-item");
    expect(items[0]).toHaveAttribute("data-active", "true");

    // ArrowDown → second
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getAllByTestId("group-picker-item")[1]).toHaveAttribute("data-active", "true");

    // ArrowDown → third
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getAllByTestId("group-picker-item")[2]).toHaveAttribute("data-active", "true");

    // ArrowUp → back to second
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getAllByTestId("group-picker-item")[1]).toHaveAttribute("data-active", "true");

    // Enter → select second group
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("g2");
  });

  it("wraps around when navigating past the last/first item", async () => {
    const groups = makeGroups(["g1", "Alpha", ["x"]], ["g2", "Beta", ["y"]]);

    render(<GroupPicker open={true} groups={groups} onSelect={noop} onClose={noop} />);

    // ArrowUp from first → wraps to last
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getAllByTestId("group-picker-item")[1]).toHaveAttribute("data-active", "true");

    // ArrowDown → wraps to first
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getAllByTestId("group-picker-item")[0]).toHaveAttribute("data-active", "true");
  });
});

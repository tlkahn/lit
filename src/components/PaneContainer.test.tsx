import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { usePaneStore } from "../stores/panes";
import type { PaneNode } from "../stores/panes";

vi.mock("./EditorPane", () => ({
  EditorPane: ({ paneId }: { paneId: string }) => (
    <div data-testid={`editor-pane-${paneId}`} />
  ),
}));

import { PaneContainer } from "./PaneContainer";

beforeEach(() => {
  usePaneStore.setState({
    root: { type: "leaf", id: "solo", pagePath: null },
    focusedPaneId: "solo",
  });
  return cleanup;
});

describe("PaneContainer", () => {
  it("single-leaf root renders one EditorPane", () => {
    const { getByTestId, queryByTestId } = render(<PaneContainer />);
    expect(getByTestId("editor-pane-solo")).toBeTruthy();
    expect(queryByTestId("pane-split")).toBeNull();
  });

  it("horizontal split renders flex-row with two EditorPanes", () => {
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "pane-a", pagePath: null },
        { type: "leaf", id: "pane-b", pagePath: null },
      ],
      sizes: [50, 50],
    };
    usePaneStore.setState({ root, focusedPaneId: "pane-a" });

    const { getByTestId } = render(<PaneContainer />);
    const split = getByTestId("pane-split");
    expect(split.className).toContain("flex-row");
    expect(getByTestId("editor-pane-pane-a")).toBeTruthy();
    expect(getByTestId("editor-pane-pane-b")).toBeTruthy();
  });

  it("vertical split renders flex-col", () => {
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "vertical",
      children: [
        { type: "leaf", id: "pane-a", pagePath: null },
        { type: "leaf", id: "pane-b", pagePath: null },
      ],
      sizes: [50, 50],
    };
    usePaneStore.setState({ root, focusedPaneId: "pane-a" });

    const { getByTestId } = render(<PaneContainer />);
    const split = getByTestId("pane-split");
    expect(split.className).toContain("flex-col");
  });

  it("children have flex-basis matching sizes", () => {
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "pane-a", pagePath: null },
        { type: "leaf", id: "pane-b", pagePath: null },
      ],
      sizes: [30, 70],
    };
    usePaneStore.setState({ root, focusedPaneId: "pane-a" });

    const { getByTestId } = render(<PaneContainer />);
    const parentA = getByTestId("editor-pane-pane-a").parentElement!;
    const parentB = getByTestId("editor-pane-pane-b").parentElement!;
    expect(parentA.style.flexBasis).toBe("30%");
    expect(parentB.style.flexBasis).toBe("70%");
  });

  it("nested splits render correct tree structure", () => {
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "pane-a", pagePath: null },
        {
          type: "split",
          id: "s2",
          direction: "vertical",
          children: [
            { type: "leaf", id: "pane-b", pagePath: null },
            { type: "leaf", id: "pane-c", pagePath: null },
          ],
          sizes: [50, 50],
        },
      ],
      sizes: [50, 50],
    };
    usePaneStore.setState({ root, focusedPaneId: "pane-a" });

    const { getAllByTestId } = render(<PaneContainer />);
    const panes = getAllByTestId(/^editor-pane-/);
    expect(panes).toHaveLength(3);

    const splits = getAllByTestId("pane-split");
    expect(splits).toHaveLength(2);

    expect(splits[0]!.className).toContain("flex-row");
    expect(splits[1]!.className).toContain("flex-col");
  });

  it("updates rendered tree after store splitPane action", () => {
    const { queryAllByTestId } = render(<PaneContainer />);
    expect(queryAllByTestId(/^editor-pane-/)).toHaveLength(1);

    act(() => {
      usePaneStore.getState().splitPane("solo", "horizontal");
    });

    expect(queryAllByTestId(/^editor-pane-/)).toHaveLength(2);
  });
});

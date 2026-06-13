import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, act, fireEvent, screen } from "@testing-library/react";
import { usePaneStore } from "../stores/panes";
import type { PaneNode } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import type { PageMeta } from "../lib/ipc";

vi.mock("./EditorPane", () => ({
  EditorPane: ({ paneId }: { paneId: string }) => (
    <div data-testid={`editor-pane-${paneId}`} />
  ),
}));

vi.mock("./PdfViewerPane", () => ({
  PdfViewerPane: ({ paneId }: { paneId: string }) => (
    <div data-testid={`pdf-viewer-pane-${paneId}`} />
  ),
}));

vi.mock("./CodeEditorPane", () => ({
  default: ({ paneId }: { paneId: string }) => (
    <div data-testid={`code-editor-pane-${paneId}`} />
  ),
}));

import { PaneContainer } from "./PaneContainer";

function meta(
  relative_path: string,
  file_type: "markdown" | "pdf" | "code",
): PageMeta {
  return {
    title: relative_path,
    relative_path,
    frontmatter: {},
    created_at: null,
    modified_at: null,
    file_type,
  };
}

beforeEach(() => {
  usePaneStore.setState({
    root: { type: "leaf", id: "solo", pagePath: null },
    focusedPaneId: "solo",
  });
  useWorkspaceStore.setState({ pages: [] });
  return cleanup;
});

describe("PaneContainer leaf routing", () => {
  it("renders PdfViewerPane for a leaf whose page is a pdf", () => {
    useWorkspaceStore.setState({ pages: [meta("doc.pdf", "pdf")] });
    usePaneStore.setState({
      root: { type: "leaf", id: "leaf-pdf", pagePath: "doc.pdf" },
      focusedPaneId: "leaf-pdf",
    });
    const { getByTestId, queryByTestId } = render(<PaneContainer />);
    expect(getByTestId("pdf-viewer-pane-leaf-pdf")).toBeTruthy();
    expect(queryByTestId("editor-pane-leaf-pdf")).toBeNull();
  });

  it("renders EditorPane for a leaf whose page is markdown", () => {
    useWorkspaceStore.setState({ pages: [meta("note.md", "markdown")] });
    usePaneStore.setState({
      root: { type: "leaf", id: "leaf-md", pagePath: "note.md" },
      focusedPaneId: "leaf-md",
    });
    const { getByTestId, queryByTestId } = render(<PaneContainer />);
    expect(getByTestId("editor-pane-leaf-md")).toBeTruthy();
    expect(queryByTestId("pdf-viewer-pane-leaf-md")).toBeNull();
  });

  it("renders EditorPane for a leaf with null pagePath", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "leaf-empty", pagePath: null },
      focusedPaneId: "leaf-empty",
    });
    const { getByTestId } = render(<PaneContainer />);
    expect(getByTestId("editor-pane-leaf-empty")).toBeTruthy();
  });

  it("routes a restored .pdf leaf to the PDF viewer (not EditorPane) while pages list is empty", () => {
    // pagePath is a restored PDF leaf but the workspace pages list has not
    // loaded yet. The .pdf extension is sniffed so the leaf renders the PDF
    // viewer immediately — never EditorPane, which would call readPage on a
    // binary file.
    usePaneStore.setState({
      root: { type: "leaf", id: "leaf-loading", pagePath: "doc.pdf" },
      focusedPaneId: "leaf-loading",
    });
    useWorkspaceStore.setState({ pages: [] });
    const { getByTestId, queryByTestId } = render(<PaneContainer />);
    expect(queryByTestId("editor-pane-leaf-loading")).toBeNull();
    expect(getByTestId("pdf-viewer-pane-leaf-loading")).toBeTruthy();
  });

  it("renders CodeEditorPane for a leaf whose page is code", async () => {
    useWorkspaceStore.setState({ pages: [meta("refs.bib", "code")] });
    usePaneStore.setState({
      root: { type: "leaf", id: "leaf-code", pagePath: "refs.bib" },
      focusedPaneId: "leaf-code",
    });
    render(<PaneContainer />);
    expect(await screen.findByTestId("code-editor-pane-leaf-code")).toBeTruthy();
    expect(screen.queryByTestId("editor-pane-leaf-code")).toBeNull();
    expect(screen.queryByTestId("pdf-viewer-pane-leaf-code")).toBeNull();
  });

  it("routes a restored .bib leaf to CodeEditorPane while pages list is empty", async () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "leaf-bib-loading", pagePath: "refs.bib" },
      focusedPaneId: "leaf-bib-loading",
    });
    useWorkspaceStore.setState({ pages: [] });
    render(<PaneContainer />);
    expect(
      await screen.findByTestId("code-editor-pane-leaf-bib-loading"),
    ).toBeTruthy();
    expect(screen.queryByTestId("editor-pane-leaf-bib-loading")).toBeNull();
  });

  it("routes a restored .md leaf to EditorPane while pages list is empty", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "leaf-md-loading", pagePath: "note.md" },
      focusedPaneId: "leaf-md-loading",
    });
    useWorkspaceStore.setState({ pages: [] });
    const { getByTestId, queryByTestId } = render(<PaneContainer />);
    expect(queryByTestId("pdf-viewer-pane-leaf-md-loading")).toBeNull();
    expect(getByTestId("editor-pane-leaf-md-loading")).toBeTruthy();
  });
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
    expect(parentA.style.flexBasis).toBe("calc(30% - 1.2px)");
    expect(parentB.style.flexBasis).toBe("calc(70% - 2.8px)");
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

  it("wraps tree in a container div with flex classes", () => {
    const { container } = render(<PaneContainer />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper.className).toContain("flex");
    expect(wrapper.className).toContain("flex-1");
    expect(wrapper.className).toContain("min-h-0");
  });

  it("passes style prop to the container div", () => {
    const { container } = render(
      <PaneContainer style={{ display: "none" }} />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.display).toBe("none");
  });

  it("renders without style prop (undefined)", () => {
    const { container } = render(<PaneContainer />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.display).toBe("");
  });

  it("updates rendered tree after store splitPane action", () => {
    const { queryAllByTestId } = render(<PaneContainer />);
    expect(queryAllByTestId(/^editor-pane-/)).toHaveLength(1);

    act(() => {
      usePaneStore.getState().splitPane("solo", "horizontal");
    });

    expect(queryAllByTestId(/^editor-pane-/)).toHaveLength(2);
  });

  // Cycle 14 — 2 children renders 1 divider
  it("horizontal split with 2 children renders 1 divider", () => {
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
    const { getAllByTestId } = render(<PaneContainer />);
    expect(getAllByTestId("pane-divider")).toHaveLength(1);
  });

  // Cycle 15 — 3 children renders 2 dividers
  it("split with 3 children renders 2 dividers", () => {
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "pane-a", pagePath: null },
        { type: "leaf", id: "pane-b", pagePath: null },
        { type: "leaf", id: "pane-c", pagePath: null },
      ],
      sizes: [33, 34, 33],
    };
    usePaneStore.setState({ root, focusedPaneId: "pane-a" });
    const { getAllByTestId } = render(<PaneContainer />);
    expect(getAllByTestId("pane-divider")).toHaveLength(2);
  });

  // Cycle 16 — single leaf renders 0 dividers
  it("single leaf renders 0 dividers", () => {
    const { queryAllByTestId } = render(<PaneContainer />);
    expect(queryAllByTestId("pane-divider")).toHaveLength(0);
  });

  // Cycle 17 — nested splits render correct divider count
  it("nested splits render correct divider count", () => {
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
    expect(getAllByTestId("pane-divider")).toHaveLength(2);
  });

  // Cycle 18 — pane wrappers have grow-0 shrink-0
  it("pane wrappers have grow-0 and shrink-0", () => {
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
    const wrapperA = getByTestId("editor-pane-pane-a").parentElement!;
    expect(wrapperA.className).toContain("grow-0");
    expect(wrapperA.className).toContain("shrink-0");
  });

  // Cycle 19 — drag divider updates store in context
  it("drag divider updates store in PaneContainer context", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      (cb as () => void)();
      return 1;
    });

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
    const divider = getByTestId("pane-divider");

    const splitEl = getByTestId("pane-split");
    splitEl.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 1000, height: 500, top: 0, right: 1000, bottom: 500, left: 0, toJSON: () => ({}) }) as DOMRect;

    act(() => {
      fireEvent.mouseDown(divider, { clientX: 500, clientY: 250 });
      fireEvent.mouseMove(document, { clientX: 600, clientY: 250 });
    });

    const updated = usePaneStore.getState().root;
    if (updated.type === "split") {
      expect(updated.sizes[0]).toBeCloseTo(60, 0);
      expect(updated.sizes[1]).toBeCloseTo(40, 0);
    }

    act(() => { fireEvent.mouseUp(document); });
    vi.restoreAllMocks();
  });

  // Cycle 20 — double-click divider equalizes in context
  it("double-click divider equalizes sizes in PaneContainer context", () => {
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
    const divider = getByTestId("pane-divider");

    act(() => {
      fireEvent.doubleClick(divider);
    });

    const updated = usePaneStore.getState().root;
    if (updated.type === "split") {
      expect(updated.sizes[0]).toBeCloseTo(50, 0);
      expect(updated.sizes[1]).toBeCloseTo(50, 0);
    }
  });

  // Cycle 2b — pixel-based min-width/min-height on pane wrappers
  it("pane wrapper has min-width of 120px for horizontal splits", () => {
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
    const wrapperA = getByTestId("editor-pane-pane-a").parentElement!;
    expect(wrapperA.style.minWidth).toBe("120px");
  });

  it("pane wrapper has min-height of 120px for vertical splits", () => {
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
    const wrapperA = getByTestId("editor-pane-pane-a").parentElement!;
    expect(wrapperA.style.minHeight).toBe("120px");
  });

  // Cycle 22 — close middle pane leaves correct pane count (#132)
  it("closing middle pane leaves 2 editor panes rendered", () => {
    useWorkspaceStore.setState({
      pages: [meta("a.md", "markdown"), meta("b.md", "markdown")],
    });
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "pane-a", pagePath: "a.md" },
        { type: "leaf", id: "pane-b", pagePath: "b.md" },
        { type: "leaf", id: "pane-c", pagePath: null },
      ],
      sizes: [33, 34, 33],
    };
    usePaneStore.setState({ root, focusedPaneId: "pane-b" });
    const { queryAllByTestId } = render(<PaneContainer />);
    expect(queryAllByTestId(/^editor-pane-/)).toHaveLength(3);

    act(() => {
      usePaneStore.getState().closePane("pane-b");
    });

    expect(queryAllByTestId(/^editor-pane-/)).toHaveLength(2);
    expect(queryAllByTestId(/^editor-pane-pane-a/)).toHaveLength(1);
    expect(queryAllByTestId(/^editor-pane-pane-c/)).toHaveLength(1);
  });

  // Cycle 21 — dividers have ARIA attributes
  it("dividers have role=separator and aria-orientation", () => {
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
    const divider = getByTestId("pane-divider");
    expect(divider.getAttribute("role")).toBe("separator");
    expect(divider.getAttribute("aria-orientation")).toBe("horizontal");
  });
});

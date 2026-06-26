import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, act, fireEvent, screen } from "@testing-library/react";
import { usePaneStore } from "../stores/panes";
import type { PaneNode } from "../stores/panes";
import { usePaneLoadingStore } from "../stores/paneLoading";
import { useWorkspaceStore } from "../stores/workspace";
import { useResponsiveLayoutStore } from "../stores/responsiveLayout";
import type { PageMeta } from "../lib/ipc";
import { getPaneView, setFocusedPane } from "../lib/editorViewRef";

vi.mock("../lib/editorViewRef", () => ({
  getPaneView: vi.fn(),
  setFocusedPane: vi.fn(),
}));

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
    has_companion: false,
  };
}

const focusSpy = vi.fn();
const mockGetPaneView = getPaneView as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    (cb as () => void)();
    return 1;
  });
  mockGetPaneView.mockImplementation(() => ({ focus: focusSpy }));
  usePaneStore.setState({
    root: { type: "leaf", id: "solo", pagePath: null },
    focusedPaneId: "solo",
  });
  usePaneLoadingStore.setState({ loadingPaneIds: new Set() });
  useWorkspaceStore.setState({ pages: [] });
  return () => {
    cleanup();
    focusSpy.mockClear();
    mockGetPaneView.mockClear();
    (setFocusedPane as ReturnType<typeof vi.fn>).mockClear();
    vi.restoreAllMocks();
  };
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

describe("PaneLeafRenderer passes props to PaneHeader", () => {
  it("passes pagePath and fileType to PaneHeader in multi-pane mode", () => {
    useWorkspaceStore.setState({
      pages: [meta("note.md", "markdown"), meta("doc.pdf", "pdf")],
    });
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "pane-a", pagePath: "note.md" },
        { type: "leaf", id: "pane-b", pagePath: "doc.pdf" },
      ],
      sizes: [50, 50],
    };
    usePaneStore.setState({ root, focusedPaneId: "pane-a" });

    render(<PaneContainer />);
    const headers = screen.getAllByTestId("pane-header-title");
    expect(headers).toHaveLength(2);
    // Markdown pane shows basename (no registered title)
    expect(headers[0]!.textContent).toBe("note.md");
    // PDF pane shows basename
    expect(headers[1]!.textContent).toBe("doc.pdf");
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
    const parentA = getByTestId("editor-pane-pane-a").closest("[data-pane-id]")!.parentElement!;
    const parentB = getByTestId("editor-pane-pane-b").closest("[data-pane-id]")!.parentElement!;
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
    const wrapperA = getByTestId("editor-pane-pane-a").closest("[data-pane-id]")!.parentElement!;
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
    const wrapperA = getByTestId("editor-pane-pane-a").closest("[data-pane-id]")!.parentElement!;
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
    const wrapperA = getByTestId("editor-pane-pane-a").closest("[data-pane-id]")!.parentElement!;
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

describe("PaneLeafRenderer focus-on-mount guard", () => {
  it("does not focus pane on initial mount in single-pane editor mode", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "solo", pagePath: null },
      focusedPaneId: "solo",
    });
    render(<PaneContainer />);
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("wrapper mouseDown on unfocused pane calls focusPane exactly once", () => {
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

    const focusPaneSpy = vi.spyOn(usePaneStore.getState(), "focusPane");

    render(<PaneContainer />);

    const wrapperB = document.querySelector('[data-pane-id="pane-b"]') as HTMLElement;
    expect(wrapperB).toBeTruthy();

    fireEvent.mouseDown(wrapperB);

    expect(focusPaneSpy).toHaveBeenCalledTimes(1);
    expect(focusPaneSpy).toHaveBeenCalledWith("pane-b");
    expect(usePaneStore.getState().focusedPaneId).toBe("pane-b");

    // Verify setFocusedPane (from editorViewRef) is called with the correct paneId
    expect(setFocusedPane).toHaveBeenCalledTimes(1);
    expect(setFocusedPane).toHaveBeenCalledWith("pane-b");

    focusPaneSpy.mockRestore();
  });

  it("multi-pane wrapper div has tabIndex -1", () => {
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
    render(<PaneContainer />);

    const wrapperA = document.querySelector('[data-pane-id="pane-a"]') as HTMLElement;
    expect(wrapperA).toBeTruthy();
    expect(wrapperA.getAttribute("tabindex")).toBe("-1");
  });

  it("multi-pane wrapper div is focusable via .focus()", () => {
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
    render(<PaneContainer />);

    const wrapperA = document.querySelector('[data-pane-id="pane-a"]') as HTMLElement;
    expect(wrapperA).toBeTruthy();
    wrapperA.focus();
    expect(document.activeElement).toBe(wrapperA);
  });

  it("does not focus non-focused pane on initial mount in multi-pane layout", () => {
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
    render(<PaneContainer />);
    // On initial mount, no pane should have focus() called
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("focuses pane when switching from non-editor to editor viewMode", () => {
    useWorkspaceStore.setState({ pages: [{ title: "note.md", relative_path: "note.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown", has_companion: false }] });
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "pane-a", pagePath: "note.md", viewMode: "mindmap" },
        { type: "leaf", id: "pane-b", pagePath: null },
      ],
      sizes: [50, 50],
    };
    usePaneStore.setState({ root, focusedPaneId: "pane-a" });
    render(<PaneContainer />);

    // No focus on initial mount
    expect(focusSpy).not.toHaveBeenCalled();

    // Now switch pane-a from mindmap to editor
    act(() => {
      usePaneStore.getState().setPaneViewMode("pane-a", "editor");
    });

    // Focus should now be called for pane-a
    expect(mockGetPaneView).toHaveBeenCalledWith("pane-a");
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it("does not focus pane when switching to editor if it is not the focused pane", () => {
    useWorkspaceStore.setState({ pages: [{ title: "a.md", relative_path: "a.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown", has_companion: false }, { title: "b.md", relative_path: "b.md", frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown", has_companion: false }] });
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "pane-a", pagePath: "a.md", viewMode: "mindmap" },
        { type: "leaf", id: "pane-b", pagePath: "b.md", viewMode: "mindmap" },
      ],
      sizes: [50, 50],
    };
    // pane-b is focused, not pane-a
    usePaneStore.setState({ root, focusedPaneId: "pane-b" });
    render(<PaneContainer />);

    // Switch pane-a (not the focused pane) to editor
    act(() => {
      usePaneStore.getState().setPaneViewMode("pane-a", "editor");
    });

    // focus() should NOT be called since pane-a is not the focused pane
    expect(focusSpy).not.toHaveBeenCalled();
  });
});

describe("PaneContainer collapsed mode", () => {
  beforeEach(() => {
    useResponsiveLayoutStore.setState({ panesCollapsed: false });
  });

  const splitRoot: PaneNode = {
    type: "split",
    id: "s1",
    direction: "horizontal",
    children: [
      { type: "leaf", id: "pane-a", pagePath: null },
      { type: "leaf", id: "pane-b", pagePath: null },
    ],
    sizes: [50, 50],
  };

  it("panesCollapsed=true shows only the focused pane", () => {
    useResponsiveLayoutStore.setState({ panesCollapsed: true });
    usePaneStore.setState({ root: splitRoot, focusedPaneId: "pane-a" });
    render(<PaneContainer />);

    const wrapperA = screen.getByTestId("editor-pane-pane-a").parentElement!;
    const wrapperB = screen.getByTestId("editor-pane-pane-b").parentElement!;
    expect(wrapperA.style.display).toBe("flex");
    expect(wrapperB.style.display).toBe("none");
  });

  it("switching focusedPaneId shows the other pane", () => {
    useResponsiveLayoutStore.setState({ panesCollapsed: true });
    usePaneStore.setState({ root: splitRoot, focusedPaneId: "pane-a" });
    render(<PaneContainer />);

    act(() => {
      usePaneStore.setState({ focusedPaneId: "pane-b" });
    });

    const wrapperA = screen.getByTestId("editor-pane-pane-a").parentElement!;
    const wrapperB = screen.getByTestId("editor-pane-pane-b").parentElement!;
    expect(wrapperA.style.display).toBe("none");
    expect(wrapperB.style.display).toBe("flex");
  });

  it("panesCollapsed=false shows all panes normally", () => {
    useResponsiveLayoutStore.setState({ panesCollapsed: false });
    usePaneStore.setState({ root: splitRoot, focusedPaneId: "pane-a" });
    render(<PaneContainer />);

    const wrapperA = screen.getByTestId("editor-pane-pane-a").parentElement!;
    const wrapperB = screen.getByTestId("editor-pane-pane-b").parentElement!;
    expect(wrapperA.style.display).toBe("");
    expect(wrapperB.style.display).toBe("");
  });
});

/**
 * Header mousedown focus-routing tests.
 *
 * jsdom does NOT implement the browser behavior of moving DOM focus to
 * the nearest focusable ancestor on mousedown. The preventDefault() call
 * that fixes the focus-steal cannot be verified in jsdom.
 *
 * Manual browser verification required:
 *   (1) In multi-pane mode, click the header title of the focused pane
 *       and verify the CM editor cursor remains visible and keystrokes
 *       still reach the editor.
 *   (2) Click the header of an unfocused editor pane and verify that
 *       pane's editor receives keyboard focus.
 */
describe("PaneLeafRenderer header mouseDown focus routing", () => {
  it("mouseDown on pane header of already-focused editor pane calls view.focus()", () => {
    useWorkspaceStore.setState({
      pages: [meta("note.md", "markdown"), meta("other.md", "markdown")],
    });
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "pane-a", pagePath: "note.md" },
        { type: "leaf", id: "pane-b", pagePath: "other.md" },
      ],
      sizes: [50, 50],
    };
    usePaneStore.setState({ root, focusedPaneId: "pane-a" });

    const viewFocusSpy = vi.fn();
    mockGetPaneView.mockImplementation((id: string) =>
      id === "pane-a" ? { focus: viewFocusSpy } : null,
    );

    render(<PaneContainer />);

    const headerA = document.querySelector('[data-pane-id="pane-a"] [data-testid="pane-header"]') as HTMLElement;
    expect(headerA).toBeTruthy();

    const focusPaneSpy = vi.spyOn(usePaneStore.getState(), "focusPane");

    fireEvent.mouseDown(headerA);

    // The CM view's focus() must be called to re-focus the editor
    expect(viewFocusSpy).toHaveBeenCalledTimes(1);
    // usePaneFocus guard should have early-returned since pane-a is already focused
    expect(focusPaneSpy).not.toHaveBeenCalled();

    focusPaneSpy.mockRestore();
  });

  it("mouseDown on pane header of unfocused pane updates store and focuses CM view", () => {
    useWorkspaceStore.setState({
      pages: [meta("note.md", "markdown"), meta("other.md", "markdown")],
    });
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "pane-a", pagePath: "note.md" },
        { type: "leaf", id: "pane-b", pagePath: "other.md" },
      ],
      sizes: [50, 50],
    };
    usePaneStore.setState({ root, focusedPaneId: "pane-a" });

    const viewFocusSpy = vi.fn();
    mockGetPaneView.mockImplementation((id: string) =>
      id === "pane-b" ? { focus: viewFocusSpy } : null,
    );

    render(<PaneContainer />);

    const headerB = document.querySelector('[data-pane-id="pane-b"] [data-testid="pane-header"]') as HTMLElement;
    expect(headerB).toBeTruthy();

    fireEvent.mouseDown(headerB);

    // Store should have been updated to pane-b
    expect(usePaneStore.getState().focusedPaneId).toBe("pane-b");
    // CM view.focus() should have been called
    expect(viewFocusSpy).toHaveBeenCalledTimes(1);
  });

  it("mouseDown on pane header of non-editor pane (no CM view) focuses the wrapper div", () => {
    useWorkspaceStore.setState({
      pages: [meta("note.md", "markdown"), meta("other.md", "markdown")],
    });
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "pane-a", pagePath: "note.md" },
        { type: "leaf", id: "pane-b", pagePath: "other.md" },
      ],
      sizes: [50, 50],
    };
    usePaneStore.setState({ root, focusedPaneId: "pane-a" });

    // No CM view for pane-b (simulating graph/cardbox/mindmap)
    mockGetPaneView.mockImplementation(() => null);

    render(<PaneContainer />);

    const wrapperB = document.querySelector('[data-pane-id="pane-b"]') as HTMLElement;
    const headerB = wrapperB.querySelector('[data-testid="pane-header"]') as HTMLElement;
    expect(headerB).toBeTruthy();

    const wrapperFocusSpy = vi.spyOn(wrapperB, "focus");

    fireEvent.mouseDown(headerB);

    // With no CM view, the wrapper div should be focused as fallback
    expect(wrapperFocusSpy).toHaveBeenCalledTimes(1);

    wrapperFocusSpy.mockRestore();
  });

  it("mouseDown on pane header calls preventDefault to suppress browser focus-steal", () => {
    useWorkspaceStore.setState({
      pages: [meta("note.md", "markdown"), meta("other.md", "markdown")],
    });
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "pane-a", pagePath: "note.md" },
        { type: "leaf", id: "pane-b", pagePath: "other.md" },
      ],
      sizes: [50, 50],
    };
    usePaneStore.setState({ root, focusedPaneId: "pane-a" });

    render(<PaneContainer />);

    const headerA = document.querySelector('[data-pane-id="pane-a"] [data-testid="pane-header"]') as HTMLElement;
    expect(headerA).toBeTruthy();

    // Create a real event and spy on preventDefault
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");

    headerA.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
  });
});

describe("PaneLeafRenderer focus border in multi-pane mode", () => {
  it("multi-pane wrapper shows focus border for editor pane", () => {
    useWorkspaceStore.setState({
      pages: [meta("note.md", "markdown"), meta("other.md", "markdown")],
    });
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "pane-a", pagePath: "note.md" },
        { type: "leaf", id: "pane-b", pagePath: "other.md" },
      ],
      sizes: [50, 50],
    };
    usePaneStore.setState({ root, focusedPaneId: "pane-a" });
    render(<PaneContainer />);

    const wrapperA = document.querySelector('[data-pane-id="pane-a"]') as HTMLElement;
    expect(wrapperA).toBeTruthy();
    expect(wrapperA.className).toContain("border-interactive-accent");
  });

  it("multi-pane wrapper shows focus border for pdf pane", () => {
    useWorkspaceStore.setState({
      pages: [meta("doc.pdf", "pdf"), meta("note.md", "markdown")],
    });
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "pane-a", pagePath: "doc.pdf" },
        { type: "leaf", id: "pane-b", pagePath: "note.md" },
      ],
      sizes: [50, 50],
    };
    usePaneStore.setState({ root, focusedPaneId: "pane-a" });
    render(<PaneContainer />);

    const wrapperA = document.querySelector('[data-pane-id="pane-a"]') as HTMLElement;
    expect(wrapperA).toBeTruthy();
    expect(wrapperA.className).toContain("border-interactive-accent");
  });

  it("multi-pane wrapper shows transparent border for UNFOCUSED pane", () => {
    useWorkspaceStore.setState({
      pages: [meta("note.md", "markdown"), meta("other.md", "markdown")],
    });
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "pane-a", pagePath: "note.md" },
        { type: "leaf", id: "pane-b", pagePath: "other.md" },
      ],
      sizes: [50, 50],
    };
    usePaneStore.setState({ root, focusedPaneId: "pane-a" });
    render(<PaneContainer />);

    const wrapperB = document.querySelector('[data-pane-id="pane-b"]') as HTMLElement;
    expect(wrapperB).toBeTruthy();
    expect(wrapperB.className).toContain("border-transparent");
    expect(wrapperB.className).not.toContain("border-interactive-accent");
  });

  it("multi-pane wrapper shows focus border for code pane", async () => {
    useWorkspaceStore.setState({
      pages: [meta("refs.bib", "code"), meta("note.md", "markdown")],
    });
    const root: PaneNode = {
      type: "split",
      id: "s1",
      direction: "horizontal",
      children: [
        { type: "leaf", id: "pane-a", pagePath: "refs.bib" },
        { type: "leaf", id: "pane-b", pagePath: "note.md" },
      ],
      sizes: [50, 50],
    };
    usePaneStore.setState({ root, focusedPaneId: "pane-a" });
    render(<PaneContainer />);

    const wrapperA = document.querySelector('[data-pane-id="pane-a"]') as HTMLElement;
    expect(wrapperA).toBeTruthy();
    expect(wrapperA.className).toContain("border-interactive-accent");
  });
});

describe("PaneContainer loading overlay", () => {
  it("shows overlay when pane is loading in single-pane mode", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "solo", pagePath: null },
      focusedPaneId: "solo",
    });
    usePaneLoadingStore.setState({ loadingPaneIds: new Set(["solo"]) });
    render(<PaneContainer />);
    expect(screen.getByTestId("pane-loading-overlay")).toBeInTheDocument();
    expect(screen.getByText("Generating title…")).toBeInTheDocument();
  });

  it("hides overlay when pane is not loading in single-pane mode", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "solo", pagePath: null },
      focusedPaneId: "solo",
    });
    render(<PaneContainer />);
    expect(screen.queryByTestId("pane-loading-overlay")).toBeNull();
  });

  it("shows overlay on correct pane in multi-pane mode", () => {
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
    usePaneLoadingStore.setState({ loadingPaneIds: new Set(["pane-a"]) });
    render(<PaneContainer />);

    const overlays = screen.getAllByTestId("pane-loading-overlay");
    expect(overlays).toHaveLength(1);

    const wrapperA = document.querySelector('[data-pane-id="pane-a"]') as HTMLElement;
    expect(wrapperA.contains(overlays[0]!)).toBe(true);
  });

  it("does not show overlay on non-loading pane in multi-pane mode", () => {
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
    usePaneLoadingStore.setState({ loadingPaneIds: new Set(["pane-b"]) });
    render(<PaneContainer />);

    const wrapperA = document.querySelector('[data-pane-id="pane-a"]') as HTMLElement;
    const wrapperB = document.querySelector('[data-pane-id="pane-b"]') as HTMLElement;
    expect(wrapperA.querySelector('[data-testid="pane-loading-overlay"]')).toBeNull();
    expect(wrapperB.querySelector('[data-testid="pane-loading-overlay"]')).toBeTruthy();
  });

  it("overlay appears and disappears reactively", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "solo", pagePath: null },
      focusedPaneId: "solo",
    });
    render(<PaneContainer />);
    expect(screen.queryByTestId("pane-loading-overlay")).toBeNull();

    act(() => {
      usePaneLoadingStore.getState().startLoading("solo");
    });
    expect(screen.getByTestId("pane-loading-overlay")).toBeInTheDocument();

    act(() => {
      usePaneLoadingStore.getState().stopLoading("solo");
    });
    expect(screen.queryByTestId("pane-loading-overlay")).toBeNull();
  });
});

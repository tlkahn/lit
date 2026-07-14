import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { BottomPanel } from "./BottomPanel";
import { getBacklinks, getUnlinkedMentions, getForwardLinks } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";
import { usePreferencesStore } from "../stores/preferences";
import { useBottomPanelStore, MIN_PANEL_WIDTH, defaultTabMeta } from "../stores/bottomPanel";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { annotationDataField, setAnnotationData } from "../editor/livePreview/annotationState";
import { setCurrentEditorView } from "../lib/editorViewRef";
import type { Annotation } from "../lib/ipc";

vi.mock("../lib/ipc", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    getBacklinks: vi.fn(async () => []),
    getUnlinkedMentions: vi.fn(async () => []),
    getForwardLinks: vi.fn(async () => []),
    parseAnnotations: vi.fn(async () => []),
    resolveAnnotationScope: vi.fn(async () => null),
  };
});


function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    form: "compact",
    annotation_type: "note",
    certainty: "neutral",
    scope: { kind: "words", value: 0 },
    body: "test body",
    date: null,
    is_structured: true,
    char_start: 0,
    char_end: 10,
    original: "<!--- n | x --->",
    ...overrides,
  };
}

function setupEditorWithAnnotations(annotations: Annotation[]) {
  const state = EditorState.create({
    doc: "a".repeat(50),
    extensions: [annotationDataField],
  });
  const view = new EditorView({ state, parent: document.createElement("div") });
  if (annotations.length > 0) {
    view.dispatch({ effects: setAnnotationData.of(annotations) });
  }
  setCurrentEditorView(view);
  return view;
}

let testEditorView: EditorView | null = null;

beforeEach(() => {
  setCurrentEditorView(null);
  useWorkspaceStore.setState({
    workspacePath: "/test",
    currentPagePath: "target.md",
    graphReady: false,
  });
  usePreferencesStore.setState({ experimentalUnlinkedReferences: true });
  useBottomPanelStore.setState({
    activeTab: "linked",
    unfolded: false,
    panelHeight: 200,
    tabMeta: defaultTabMeta(),
  });
  vi.mocked(getBacklinks).mockResolvedValue([]);
  vi.mocked(getUnlinkedMentions).mockResolvedValue([]);
  vi.mocked(getForwardLinks).mockResolvedValue([]);
});

afterEach(() => {
  testEditorView?.destroy();
  testEditorView = null;
  setCurrentEditorView(null);
});

describe("BottomPanel", () => {
  it("starts folded — panel height is 0", () => {
    render(<BottomPanel pageId="target.md" />);
    const panel = screen.getByTestId("bottom-panel");
    expect(panel.style.height).toBe("0px");
  });

  it("renders without pageId — Backlinks do not mount", () => {
    render(<BottomPanel />);

    act(() => {
      useBottomPanelStore.setState({
        unfolded: true,
        activeTab: "linked",
      });
    });

    expect(screen.queryByText("No other pages link to this page")).toBeNull();
  });

  it("renders backlinks content when unfolded via store", async () => {
    useWorkspaceStore.setState({ graphReady: true });
    await act(async () => {
      render(<BottomPanel pageId="target.md" />);
    });

    act(() => {
      useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
    });

    const panel = screen.getByTestId("bottom-panel");
    expect(panel.style.height).not.toBe("0px");
    await waitFor(() => {
      expect(screen.getByText("No other pages link to this page")).toBeInTheDocument();
    });
  });

  it("panel body has CSS transition style", () => {
    render(<BottomPanel pageId="target.md" />);
    const panel = screen.getByTestId("bottom-panel");
    expect(panel.style.transition).toContain("height");
  });

  it("has no shadow class when folded", () => {
    render(<BottomPanel pageId="target.md" />);
    const panel = screen.getByTestId("bottom-panel");
    expect(panel.className).not.toContain("shadow-");
  });

  it("has no shadow class when unfolded", () => {
    render(<BottomPanel pageId="target.md" />);
    act(() => {
      useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
    });
    const panel = screen.getByTestId("bottom-panel");
    expect(panel.className).not.toContain("shadow-");
  });

  describe("content rendering", () => {
    it("shows linked content when activeTab is linked", async () => {
      useWorkspaceStore.setState({ graphReady: true });
      await act(async () => {
        render(<BottomPanel pageId="target.md" />);
      });

      act(() => {
        useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
      });

      await waitFor(() => {
        expect(screen.getByText("No other pages link to this page")).toBeInTheDocument();
      });
    });

    it("shows unlinked content when activeTab is unlinked and hasOpenedUnlinked", async () => {
      await act(async () => {
        render(<BottomPanel pageId="target.md" />);
      });

      await act(async () => {
        useBottomPanelStore.setState({
          unfolded: true,
          activeTab: "unlinked",
          tabMeta: { ...defaultTabMeta(), unlinked: { count: null, hasOpened: true } },
        });
      });

      await waitFor(() => {
        expect(screen.getByText("No unlinked mentions found")).toBeInTheDocument();
      });
    });

    it("shows outgoing content when activeTab is outgoing and hasOpenedOutgoing", async () => {
      useWorkspaceStore.setState({ graphReady: true });
      await act(async () => {
        render(<BottomPanel pageId="target.md" />);
      });

      act(() => {
        useBottomPanelStore.setState({
          unfolded: true,
          activeTab: "outgoing",
          tabMeta: { ...defaultTabMeta(), outgoing: { count: null, hasOpened: true } },
        });
      });

      await waitFor(() => {
        expect(screen.getByText("This page does not link to any other pages")).toBeInTheDocument();
      });
    });

    it("shows annotation content when activeTab is annotations and hasOpenedAnnotations", async () => {
      testEditorView = setupEditorWithAnnotations([
        makeAnnotation({ char_start: 0, char_end: 10, body: "my note" }),
      ]);
      render(<BottomPanel pageId="target.md" />);

      act(() => {
        useBottomPanelStore.setState({
          unfolded: true,
          activeTab: "annotations",
          tabMeta: { ...defaultTabMeta(), annotations: { count: 0, hasOpened: true } },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("annotation-body-0").textContent).toBe("my note");
      });
    });
  });

  describe("lazy mounting", () => {
    it("does not mount UnlinkedMentionsPanel until hasOpenedUnlinked is true", async () => {
      vi.mocked(getUnlinkedMentions).mockClear();

      render(<BottomPanel pageId="target.md" />);

      act(() => {
        useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
      });

      await act(async () => {});
      expect(getUnlinkedMentions).not.toHaveBeenCalled();

      await act(async () => {
        useBottomPanelStore.setState({
          activeTab: "unlinked",
          tabMeta: { ...defaultTabMeta(), unlinked: { count: null, hasOpened: true } },
        });
      });

      await waitFor(() => {
        expect(getUnlinkedMentions).toHaveBeenCalled();
      });
    });

    it("does not mount OutgoingLinksPanel until hasOpenedOutgoing is true", async () => {
      vi.mocked(getForwardLinks).mockClear();
      useWorkspaceStore.setState({ graphReady: true });

      render(<BottomPanel pageId="target.md" />);

      act(() => {
        useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
      });

      await act(async () => {});
      expect(getForwardLinks).not.toHaveBeenCalled();

      await act(async () => {
        useBottomPanelStore.setState({
          activeTab: "outgoing",
          tabMeta: { ...defaultTabMeta(), outgoing: { count: null, hasOpened: true } },
        });
      });

      await waitFor(() => {
        expect(getForwardLinks).toHaveBeenCalled();
      });
    });

    it("does not mount AnnotationPanel until hasOpenedAnnotations is true", () => {
      testEditorView = setupEditorWithAnnotations([
        makeAnnotation({ char_start: 0, char_end: 10, body: "lazy" }),
      ]);
      render(<BottomPanel pageId="target.md" />);

      act(() => {
        useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
      });

      expect(screen.queryByTestId("annotation-entry-0")).not.toBeInTheDocument();
    });
  });

  describe("ARIA attributes", () => {
    it("panel body has role=tabpanel when unfolded", () => {
      render(<BottomPanel pageId="target.md" />);
      act(() => {
        useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
      });
      expect(screen.getByRole("tabpanel")).toBeInTheDocument();
    });

    it("panel body aria-labelledby points to active tab id", () => {
      render(<BottomPanel pageId="target.md" />);
      act(() => {
        useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
      });
      const tabpanel = screen.getByRole("tabpanel");
      expect(tabpanel).toHaveAttribute("aria-labelledby", "bp-tab-linked");
    });

    it("switching activeTab updates aria-labelledby", async () => {
      render(<BottomPanel pageId="target.md" />);
      await act(async () => {
        useBottomPanelStore.setState({
          unfolded: true,
          activeTab: "unlinked",
          tabMeta: { ...defaultTabMeta(), unlinked: { count: null, hasOpened: true } },
        });
      });
      const tabpanel = screen.getByRole("tabpanel");
      expect(tabpanel).toHaveAttribute("aria-labelledby", "bp-tab-unlinked");
    });
  });

  describe("scroll isolation", () => {
    const backlinkEntry = { source_id: "a.md", source_title: "A", context: "ctx", source_line: 1 };
    const unlinkedEntry = { source_id: "b.md", source_title: "B", context: "ctx", source_line: 1, matched_text: "target" };

    it("each panel has its own scroll container", async () => {
      vi.mocked(getBacklinks).mockResolvedValue([backlinkEntry]);
      vi.mocked(getUnlinkedMentions).mockResolvedValue([unlinkedEntry]);
      useWorkspaceStore.setState({ graphReady: true });

      await act(async () => {
        render(<BottomPanel pageId="target.md" />);
      });

      act(() => {
        useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
      });
      await waitFor(() => {
        expect(screen.getByTestId("backlinks-scroll-container")).toBeInTheDocument();
      });

      await act(async () => {
        useBottomPanelStore.setState({
          activeTab: "unlinked",
          tabMeta: { ...defaultTabMeta(), unlinked: { count: null, hasOpened: true } },
        });
      });
      await waitFor(() => {
        expect(screen.getByTestId("unlinked-scroll-container")).toBeInTheDocument();
      });
    });

    it("tabpanel div does not scroll itself", () => {
      render(<BottomPanel pageId="target.md" />);
      act(() => {
        useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
      });

      const tabpanel = screen.getByRole("tabpanel");
      expect(tabpanel.className).toContain("overflow-hidden");
      expect(tabpanel.className).not.toContain("overflow-y-auto");
    });

    it("passes contentHeight equal to panelHeight to panels", async () => {
      vi.mocked(getBacklinks).mockResolvedValue([
        { source_id: "a.md", source_title: "A", context: "ctx", source_line: 1 },
      ]);
      useWorkspaceStore.setState({ graphReady: true });

      await act(async () => {
        render(<BottomPanel pageId="target.md" />);
      });
      act(() => {
        useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
      });

      await waitFor(() => {
        const scrollContainer = screen.getByTestId("backlinks-scroll-container");
        // contentHeight = panelHeight directly (no TAB_BAR_HEIGHT subtraction)
        expect(scrollContainer.style.height).toBe("200px");
      });
    });
  });

  describe("drag resize", () => {
    function mockParentBoundingRect(panel: HTMLElement, height: number) {
      const parent = panel.parentElement!;
      parent.getBoundingClientRect = () =>
        ({
          x: 0,
          y: 0,
          width: 800,
          height,
          top: 0,
          right: 800,
          bottom: height,
          left: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    }

    describe("localStorage persistence", () => {
      it("restores height from localStorage on mount", () => {
        localStorage.setItem("lit-bottom-panel-height", "350");
        useBottomPanelStore.setState({ panelHeight: 350 });
        render(<BottomPanel pageId="target.md" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        expect(panel.style.height).toBe("350px");
      });

      it("uses DEFAULT_PANEL_HEIGHT when localStorage is empty", () => {
        render(<BottomPanel pageId="target.md" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        expect(panel.style.height).toBe("200px");
      });
    });

    describe("resize handle", () => {
      it("exists with data-testid", () => {
        render(<BottomPanel pageId="target.md" />);
        expect(screen.getByTestId("resize-handle")).toBeInTheDocument();
      });

      it("has cursor ns-resize", () => {
        render(<BottomPanel pageId="target.md" />);
        const handle = screen.getByTestId("resize-handle");
        expect(handle.style.cursor).toBe("ns-resize");
      });

      it("is 4px tall", () => {
        render(<BottomPanel pageId="target.md" />);
        const handle = screen.getByTestId("resize-handle");
        expect(handle.style.height).toBe("4px");
      });
    });

    describe("core drag", () => {
      it("drag up increases height", () => {
        render(<BottomPanel pageId="target.md" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
          fireEvent.mouseMove(document, { clientY: 400 });
        });
        expect(panel.style.height).toBe("300px");
      });

      it("clamps to min 100px", () => {
        render(<BottomPanel pageId="target.md" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
          fireEvent.mouseMove(document, { clientY: 700 });
        });
        expect(panel.style.height).toBe("100px");
      });

      it("clamps to 60% of parent", () => {
        render(<BottomPanel pageId="target.md" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 500);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
          fireEvent.mouseMove(document, { clientY: 100 });
        });
        expect(panel.style.height).toBe("300px");
      });

      it("persists final height to localStorage on mouseup", () => {
        render(<BottomPanel pageId="target.md" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
          fireEvent.mouseMove(document, { clientY: 400 });
          fireEvent.mouseUp(document);
        });
        expect(localStorage.getItem("lit-bottom-panel-height")).toBe("300");
      });

      it("does not drag when panel is folded", () => {
        render(<BottomPanel pageId="target.md" />);
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
          fireEvent.mouseMove(document, { clientY: 400 });
        });
        expect(panel.style.height).toBe("0px");
      });

      it("multiple mousemove events update height continuously", () => {
        render(<BottomPanel pageId="target.md" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
        });
        act(() => {
          fireEvent.mouseMove(document, { clientY: 450 });
        });
        expect(panel.style.height).toBe("250px");
        act(() => {
          fireEvent.mouseMove(document, { clientY: 400 });
        });
        expect(panel.style.height).toBe("300px");
        act(() => {
          fireEvent.mouseMove(document, { clientY: 350 });
        });
        expect(panel.style.height).toBe("350px");
      });
    });

    describe("transition during drag", () => {
      it("disables transition during drag and restores after", () => {
        render(<BottomPanel pageId="target.md" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        expect(panel.style.transition).toBe("height 150ms ease-out");

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
        });
        expect(panel.style.transition).toBe("none");

        act(() => {
          fireEvent.mouseUp(document);
        });
        expect(panel.style.transition).toBe("height 150ms ease-out");
      });
    });

    describe("user-select during drag", () => {
      it("sets body user-select to none during drag and clears after", () => {
        render(<BottomPanel pageId="target.md" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
        });
        expect(document.body.style.userSelect).toBe("none");

        act(() => {
          fireEvent.mouseUp(document);
        });
        expect(document.body.style.userSelect).toBe("");
      });
    });

    describe("window resize re-clamp", () => {
      it("re-clamps height when window resizes and parent shrinks", () => {
        render(<BottomPanel pageId="target.md" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked", panelHeight: 400 });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        expect(panel.style.height).toBe("400px");

        mockParentBoundingRect(panel, 500);
        act(() => {
          window.dispatchEvent(new Event("resize"));
        });
        expect(panel.style.height).toBe("300px");
      });

      it("does NOT re-clamp when folded", () => {
        localStorage.setItem("lit-bottom-panel-height", "400");
        useBottomPanelStore.setState({ panelHeight: 400 });
        render(<BottomPanel pageId="target.md" />);
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 300);

        act(() => {
          window.dispatchEvent(new Event("resize"));
        });
        expect(panel.style.height).toBe("0px");
        expect(localStorage.getItem("lit-bottom-panel-height")).toBe("400");
      });

      it("persists re-clamped height to localStorage", () => {
        render(<BottomPanel pageId="target.md" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked", panelHeight: 400 });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        mockParentBoundingRect(panel, 500);
        act(() => {
          window.dispatchEvent(new Event("resize"));
        });
        expect(localStorage.getItem("lit-bottom-panel-height")).toBe("300");
      });

      it("clamps on unfold if stored height exceeds current 60% max", () => {
        render(<BottomPanel pageId="target.md" />);
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 500);

        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked", panelHeight: 400 });
        });
        expect(panel.style.height).toBe("300px");
      });
    });

    describe("edge cases", () => {
      it("content area div height updates with panelHeight", () => {
        render(<BottomPanel pageId="target.md" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const contentArea = screen.getByRole("tabpanel");
        expect(contentArea.style.height).toBe("200px");

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
          fireEvent.mouseMove(document, { clientY: 400 });
          fireEvent.mouseUp(document);
        });
        expect(contentArea.style.height).toBe("300px");
      });

      it("unmount during drag does not throw", () => {
        const { unmount } = render(<BottomPanel pageId="target.md" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
          fireEvent.mouseMove(document, { clientY: 400 });
        });

        expect(() => unmount()).not.toThrow();
      });
    });

    describe("ref-based drag optimization", () => {
      it("child contentHeight does NOT update during drag, only on mouseUp", async () => {
        vi.mocked(getBacklinks).mockResolvedValue([
          { source_id: "a.md", source_title: "A", context: "ctx", source_line: 1 },
        ]);
        useWorkspaceStore.setState({ graphReady: true });

        await act(async () => {
          render(<BottomPanel pageId="target.md" />);
        });
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });

        await waitFor(() => {
          expect(screen.getByTestId("backlinks-scroll-container")).toBeInTheDocument();
        });

        const scrollContainer = screen.getByTestId("backlinks-scroll-container");
        expect(scrollContainer.style.height).toBe("200px");

        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
        });
        act(() => {
          fireEvent.mouseMove(document, { clientY: 400 });
        });

        // During drag, child contentHeight stays at original value
        expect(scrollContainer.style.height).toBe("200px");

        act(() => {
          fireEvent.mouseUp(document);
        });
        expect(scrollContainer.style.height).toBe("300px");
      });

      it("contentRef height updates via DOM during drag", () => {
        render(<BottomPanel pageId="target.md" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });

        const tabpanel = screen.getByRole("tabpanel");
        expect(tabpanel.style.height).toBe("200px");

        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientY: 500 });
          fireEvent.mouseMove(document, { clientY: 400 });
        });

        expect(tabpanel.style.height).toBe("300px");

        act(() => {
          fireEvent.mouseUp(document);
        });
        expect(tabpanel.style.height).toBe("300px");
      });
    });
  });

  describe("vertical (direction) mode", () => {
    function mockParentBoundingRect(panel: HTMLElement, height: number, width = 800) {
      const parent = panel.parentElement!;
      parent.getBoundingClientRect = () =>
        ({
          x: 0,
          y: 0,
          width,
          height,
          top: 0,
          right: width,
          bottom: height,
          left: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    }

    describe("prop defaults", () => {
      it("direction defaults to 'bottom' — height-based sizing", () => {
        render(<BottomPanel pageId="target.md" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        expect(panel.style.height).toBe("200px");
        expect(panel.style.width).toBe("");
      });

      it("explicit direction='bottom' is same as default", () => {
        render(<BottomPanel pageId="target.md" direction="bottom" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        expect(panel.style.height).toBe("200px");
        expect(panel.style.width).toBe("");
      });
    });

    describe("vertical sizing", () => {
      it("direction='right' unfolded uses width, not height", () => {
        useBottomPanelStore.setState({ panelWidth: 400 });
        render(<BottomPanel pageId="target.md" direction="right" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        expect(panel.style.width).toBe("400px");
        expect(panel.style.height).toBe("");
      });

      it("direction='right' folded has width 0", () => {
        render(<BottomPanel pageId="target.md" direction="right" />);
        const panel = screen.getByTestId("bottom-panel");
        expect(panel.style.width).toBe("0px");
      });

      it("direction='left' unfolded uses width", () => {
        useBottomPanelStore.setState({ panelWidth: 400 });
        render(<BottomPanel pageId="target.md" direction="left" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        expect(panel.style.width).toBe("400px");
        expect(panel.style.height).toBe("");
      });
    });

    describe("resize handle orientation", () => {
      it("direction='right' handle has ew-resize cursor on left edge", () => {
        render(<BottomPanel pageId="target.md" direction="right" />);
        const handle = screen.getByTestId("resize-handle");
        expect(handle.style.cursor).toBe("ew-resize");
        expect(handle.style.width).toBe("4px");
        expect(handle.style.left).toBe("0px");
        expect(handle.style.top).toBe("0px");
        expect(handle.style.bottom).toBe("0px");
      });

      it("direction='left' handle has ew-resize cursor on right edge", () => {
        render(<BottomPanel pageId="target.md" direction="left" />);
        const handle = screen.getByTestId("resize-handle");
        expect(handle.style.cursor).toBe("ew-resize");
        expect(handle.style.width).toBe("4px");
        expect(handle.style.right).toBe("0px");
        expect(handle.style.top).toBe("0px");
        expect(handle.style.bottom).toBe("0px");
      });

      it("direction='bottom' handle unchanged (ns-resize)", () => {
        render(<BottomPanel pageId="target.md" direction="bottom" />);
        const handle = screen.getByTestId("resize-handle");
        expect(handle.style.cursor).toBe("ns-resize");
        expect(handle.style.height).toBe("4px");
        expect(handle.style.top).toBe("0px");
        expect(handle.style.left).toBe("0px");
        expect(handle.style.right).toBe("0px");
      });
    });

    describe("horizontal drag: direction='right'", () => {
      it("drag left increases width", () => {
        useBottomPanelStore.setState({ panelWidth: 320 });
        render(<BottomPanel pageId="target.md" direction="right" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 600, 800);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientX: 500 });
          fireEvent.mouseMove(document, { clientX: 400 });
        });
        expect(panel.style.width).toBe("400px");
      });

      it("drag right decreases width", () => {
        useBottomPanelStore.setState({ panelWidth: 320 });
        render(<BottomPanel pageId="target.md" direction="right" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 600, 800);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientX: 500 });
          fireEvent.mouseMove(document, { clientX: 550 });
        });
        expect(panel.style.width).toBe("270px");
      });
    });

    describe("horizontal drag: direction='left'", () => {
      it("drag right increases width", () => {
        useBottomPanelStore.setState({ panelWidth: 320 });
        render(<BottomPanel pageId="target.md" direction="left" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 600, 1000);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientX: 320 });
          fireEvent.mouseMove(document, { clientX: 420 });
        });
        expect(panel.style.width).toBe("420px");
      });

      it("drag left decreases width", () => {
        useBottomPanelStore.setState({ panelWidth: 320 });
        render(<BottomPanel pageId="target.md" direction="left" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 600, 800);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientX: 320 });
          fireEvent.mouseMove(document, { clientX: 270 });
        });
        expect(panel.style.width).toBe("270px");
      });
    });

    describe("width clamping", () => {
      it("clamps to MIN_PANEL_WIDTH", () => {
        useBottomPanelStore.setState({ panelWidth: 320 });
        render(<BottomPanel pageId="target.md" direction="right" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 600, 800);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientX: 500 });
          fireEvent.mouseMove(document, { clientX: 800 });
        });
        expect(panel.style.width).toBe(`${MIN_PANEL_WIDTH}px`);
      });

      it("clamps to 50% of parent width", () => {
        useBottomPanelStore.setState({ panelWidth: 320 });
        render(<BottomPanel pageId="target.md" direction="right" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 600, 800);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientX: 500 });
          fireEvent.mouseMove(document, { clientX: 0 });
        });
        expect(panel.style.width).toBe("400px");
      });
    });

    describe("persist width on mouseUp", () => {
      it("updates localStorage and store on mouseUp", () => {
        useBottomPanelStore.setState({ panelWidth: 320 });
        render(<BottomPanel pageId="target.md" direction="right" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 600, 800);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientX: 500 });
          fireEvent.mouseMove(document, { clientX: 400 });
          fireEvent.mouseUp(document);
        });
        expect(localStorage.getItem("lit-bottom-panel-width")).toBe("400");
        expect(useBottomPanelStore.getState().panelWidth).toBe(400);
      });
    });

    describe("transition in vertical mode", () => {
      it("resting state uses width transition", () => {
        render(<BottomPanel pageId="target.md" direction="right" />);
        const panel = screen.getByTestId("bottom-panel");
        expect(panel.style.transition).toBe("width 150ms ease-out");
      });

      it("disables transition during drag and restores after", () => {
        useBottomPanelStore.setState({ panelWidth: 320 });
        render(<BottomPanel pageId="target.md" direction="right" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 600, 800);

        expect(panel.style.transition).toBe("width 150ms ease-out");

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientX: 500 });
        });
        expect(panel.style.transition).toBe("none");

        act(() => {
          fireEvent.mouseUp(document);
        });
        expect(panel.style.transition).toBe("width 150ms ease-out");
      });
    });

    describe("window resize re-clamp (vertical)", () => {
      it("re-clamps width when parent shrinks", () => {
        useBottomPanelStore.setState({ panelWidth: 400 });
        render(<BottomPanel pageId="target.md" direction="right" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 600, 800);

        expect(panel.style.width).toBe("400px");

        mockParentBoundingRect(panel, 600, 500);
        act(() => {
          window.dispatchEvent(new Event("resize"));
        });
        expect(panel.style.width).toBe("250px");
      });

      it("does NOT re-clamp when folded", () => {
        localStorage.setItem("lit-bottom-panel-width", "400");
        useBottomPanelStore.setState({ panelWidth: 400 });
        render(<BottomPanel pageId="target.md" direction="right" />);
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 600, 500);

        act(() => {
          window.dispatchEvent(new Event("resize"));
        });
        expect(panel.style.width).toBe("0px");
        expect(localStorage.getItem("lit-bottom-panel-width")).toBe("400");
      });

      it("persists re-clamped width to localStorage", () => {
        useBottomPanelStore.setState({ panelWidth: 400 });
        render(<BottomPanel pageId="target.md" direction="right" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 600, 800);

        mockParentBoundingRect(panel, 600, 500);
        act(() => {
          window.dispatchEvent(new Event("resize"));
        });
        expect(localStorage.getItem("lit-bottom-panel-width")).toBe("250");
      });
    });

    describe("clamp on unfold (vertical)", () => {
      it("clamps stored width to 50% of parent on unfold", () => {
        useBottomPanelStore.setState({ panelWidth: 400 });
        render(<BottomPanel pageId="target.md" direction="right" />);
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 600, 500);

        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        expect(panel.style.width).toBe("250px");
      });
    });

    describe("content area dimension", () => {
      it("tabpanel uses style.width in vertical mode", () => {
        useBottomPanelStore.setState({ panelWidth: 320 });
        render(<BottomPanel pageId="target.md" direction="right" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const tabpanel = screen.getByRole("tabpanel");
        expect(tabpanel.style.width).toBe("320px");
        expect(tabpanel.style.height).toBe("");
      });

      it("contentRef width updates via DOM during drag", () => {
        useBottomPanelStore.setState({ panelWidth: 320 });
        render(<BottomPanel pageId="target.md" direction="right" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 600, 1000);

        const tabpanel = screen.getByRole("tabpanel");
        expect(tabpanel.style.width).toBe("320px");

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientX: 500 });
          fireEvent.mouseMove(document, { clientX: 400 });
        });
        expect(tabpanel.style.width).toBe("420px");
      });
    });

    describe("folded guard (vertical)", () => {
      it("drag on folded panel keeps width at 0", () => {
        useBottomPanelStore.setState({ panelWidth: 320 });
        render(<BottomPanel pageId="target.md" direction="right" />);
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 600, 800);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientX: 500 });
          fireEvent.mouseMove(document, { clientX: 400 });
        });
        expect(panel.style.width).toBe("0px");
      });
    });

    describe("user-select during vertical drag", () => {
      it("sets body user-select to none during drag and clears after", () => {
        useBottomPanelStore.setState({ panelWidth: 320 });
        render(<BottomPanel pageId="target.md" direction="right" />);
        act(() => {
          useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
        });
        const panel = screen.getByTestId("bottom-panel");
        mockParentBoundingRect(panel, 600, 800);

        const handle = screen.getByTestId("resize-handle");
        act(() => {
          fireEvent.mouseDown(handle, { clientX: 500 });
        });
        expect(document.body.style.userSelect).toBe("none");

        act(() => {
          fireEvent.mouseUp(document);
        });
        expect(document.body.style.userSelect).toBe("");
      });
    });
  });
});

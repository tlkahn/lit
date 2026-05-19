import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { BottomPanel } from "./BottomPanel";
import { mockInvoke } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import { usePreferencesStore } from "../stores/preferences";
import { useBottomPanelStore } from "../stores/bottomPanel";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { annotationDataField, setAnnotationData } from "../editor/livePreview/annotationState";
import { setCurrentEditorView } from "../lib/editorViewRef";
import type { Annotation } from "../lib/ipc";

vi.mock("../lib/ipc", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
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
    original: "%%!n | x%%",
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
    graphReady: true,
  });
  usePreferencesStore.setState({ experimentalUnlinkedReferences: true });
  useBottomPanelStore.setState({
    activeTab: "linked",
    unfolded: false,
    panelHeight: 200,
    linkedCount: null,
    unlinkedCount: null,
    annotationCount: 0,
    hasOpenedUnlinked: false,
    hasOpenedAnnotations: false,
  });
  mockInvoke((cmd) => {
    if (cmd === "get_backlinks") return [];
    if (cmd === "get_unlinked_mentions") return [];
    throw new Error(`Unknown command: ${cmd}`);
  });
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

  it("renders backlinks content when unfolded via store", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_backlinks") return [];
      if (cmd === "get_unlinked_mentions") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<BottomPanel pageId="target.md" />);

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

  it("has shadow class when unfolded", () => {
    render(<BottomPanel pageId="target.md" />);
    act(() => {
      useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
    });
    const panel = screen.getByTestId("bottom-panel");
    expect(panel.className).toContain("shadow-");
  });

  describe("content rendering", () => {
    it("shows linked content when activeTab is linked", async () => {
      mockInvoke((cmd) => {
        if (cmd === "get_backlinks") return [];
        if (cmd === "get_unlinked_mentions") return [];
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<BottomPanel pageId="target.md" />);

      act(() => {
        useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
      });

      await waitFor(() => {
        expect(screen.getByText("No other pages link to this page")).toBeInTheDocument();
      });
    });

    it("shows unlinked content when activeTab is unlinked and hasOpenedUnlinked", async () => {
      mockInvoke((cmd) => {
        if (cmd === "get_backlinks") return [];
        if (cmd === "get_unlinked_mentions") return [];
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<BottomPanel pageId="target.md" />);

      act(() => {
        useBottomPanelStore.setState({
          unfolded: true,
          activeTab: "unlinked",
          hasOpenedUnlinked: true,
        });
      });

      await waitFor(() => {
        expect(screen.getByText("No unlinked mentions found")).toBeInTheDocument();
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
          hasOpenedAnnotations: true,
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("annotation-body-0").textContent).toBe("my note");
      });
    });
  });

  describe("lazy mounting", () => {
    it("does not mount UnlinkedMentionsPanel until hasOpenedUnlinked is true", async () => {
      let fetchCount = 0;
      mockInvoke((cmd) => {
        if (cmd === "get_backlinks") return [];
        if (cmd === "get_unlinked_mentions") {
          fetchCount++;
          return [];
        }
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<BottomPanel pageId="target.md" />);

      act(() => {
        useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
      });

      // Allow any pending effects to settle
      await act(async () => {});
      expect(fetchCount).toBe(0);

      act(() => {
        useBottomPanelStore.setState({ activeTab: "unlinked", hasOpenedUnlinked: true });
      });

      await waitFor(() => {
        expect(fetchCount).toBeGreaterThan(0);
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

    it("switching activeTab updates aria-labelledby", () => {
      render(<BottomPanel pageId="target.md" />);
      act(() => {
        useBottomPanelStore.setState({
          unfolded: true,
          activeTab: "unlinked",
          hasOpenedUnlinked: true,
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
      mockInvoke((cmd) => {
        if (cmd === "get_backlinks") return [backlinkEntry];
        if (cmd === "get_unlinked_mentions") return [unlinkedEntry];
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<BottomPanel pageId="target.md" />);

      act(() => {
        useBottomPanelStore.setState({ unfolded: true, activeTab: "linked" });
      });
      await waitFor(() => {
        expect(screen.getByTestId("backlinks-scroll-container")).toBeInTheDocument();
      });

      act(() => {
        useBottomPanelStore.setState({ activeTab: "unlinked", hasOpenedUnlinked: true });
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
      mockInvoke((cmd) => {
        if (cmd === "get_backlinks") return [
          { source_id: "a.md", source_title: "A", context: "ctx", source_line: 1 },
        ];
        if (cmd === "get_unlinked_mentions") return [];
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<BottomPanel pageId="target.md" />);
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
        const backlinkEntry = { source_id: "a.md", source_title: "A", context: "ctx", source_line: 1 };
        mockInvoke((cmd) => {
          if (cmd === "get_backlinks") return [backlinkEntry];
          if (cmd === "get_unlinked_mentions") return [];
          throw new Error(`Unknown command: ${cmd}`);
        });

        render(<BottomPanel pageId="target.md" />);
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
});

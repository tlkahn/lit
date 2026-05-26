import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import { mockInvoke } from "../test/tauri-mock";
import { useGraphSelectionStore } from "../stores/graphSelection";
import { GraphContextMenu } from "./GraphContextMenu";
import type { PageContent, SplitPlan } from "../lib/ipc";

const makePage = (id: string, body: string): PageContent => ({
  meta: { title: id.replace(".md", ""), relative_path: id, frontmatter: {}, created_at: null, modified_at: null, file_type: "markdown" },
  body,
  raw_yaml: "",
});

describe("GraphContextMenu", () => {
  const defaultProps = () => ({
    contextMenu: { nodeId: "a.md", x: 100, y: 200 } as { nodeId: string; x: number; y: number } | null,
    onClose: vi.fn(),
    selectionCount: 0,
    llmEnabled: false,
    graphRef: { current: { getNodeAttribute: (_id: string, _attr: string) => _id.replace(".md", "") } } as React.RefObject<{ getNodeAttribute: (node: string, attr: string) => unknown } | null>,
    onDeleteRequest: vi.fn(),
    onMergeRequest: vi.fn(),
    onSplitRequest: vi.fn(),
    onExportNetwork: undefined as ((nodeId: string) => void) | undefined,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useGraphSelectionStore.setState({ selectedNodes: [], selectionMode: "none" });
    mockInvoke((cmd, args) => {
      switch (cmd) {
        case "read_page": {
          const id = (args as { relativePath: string }).relativePath;
          return makePage(id, `# Title\n\nBody of ${id}\n\n## Section\n\nMore text`);
        }
        case "preview_split":
          return { preamble: null, sections: [{ title: "Section", body: "More text", frontmatter: {} }] } satisfies SplitPlan;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
  });

  it("renders nothing when contextMenu is null", () => {
    const props = defaultProps();
    props.contextMenu = null;
    const { container } = render(<GraphContextMenu {...props} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders at correct left/top position", () => {
    const props = defaultProps();
    const { container } = render(<GraphContextMenu {...props} />);
    const menu = container.querySelector("[data-graph-context-menu]") as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.style.left).toBe("100px");
    expect(menu.style.top).toBe("200px");
  });

  it("shows merge button when selectionCount >= 2", () => {
    const props = defaultProps();
    props.selectionCount = 3;
    const { container } = render(<GraphContextMenu {...props} />);
    expect(container.querySelector("[data-testid='ctx-merge-btn']")).toBeTruthy();
    expect(container.querySelector("[data-testid='ctx-split-btn']")).toBeNull();
  });

  it("hides merge button when selectionCount < 2", () => {
    const props = defaultProps();
    props.selectionCount = 1;
    const { container } = render(<GraphContextMenu {...props} />);
    expect(container.querySelector("[data-testid='ctx-merge-btn']")).toBeNull();
  });

  it("shows split button when selectionCount <= 1", () => {
    const props = defaultProps();
    props.selectionCount = 0;
    const { container } = render(<GraphContextMenu {...props} />);
    expect(container.querySelector("[data-testid='ctx-split-btn']")).toBeTruthy();
  });

  it("hides split button when selectionCount >= 2", () => {
    const props = defaultProps();
    props.selectionCount = 2;
    const { container } = render(<GraphContextMenu {...props} />);
    expect(container.querySelector("[data-testid='ctx-split-btn']")).toBeNull();
  });

  it("split button is disabled while loading headings", () => {
    const props = defaultProps();
    mockInvoke(() => new Promise(() => {}));
    const { container } = render(<GraphContextMenu {...props} />);
    const splitBtn = container.querySelector("[data-testid='ctx-split-btn']") as HTMLButtonElement;
    expect(splitBtn.disabled).toBe(true);
  });

  it("split button is disabled when no headings found", async () => {
    const props = defaultProps();
    mockInvoke((cmd) => {
      if (cmd === "read_page") return makePage("a.md", "No headings here");
      throw new Error(`Unknown: ${cmd}`);
    });
    const { container } = render(<GraphContextMenu {...props} />);
    await waitFor(() => {
      const splitBtn = container.querySelector("[data-testid='ctx-split-btn']") as HTMLButtonElement;
      expect(splitBtn.disabled).toBe(true);
    });
  });

  it("split button is enabled when headings found", async () => {
    const props = defaultProps();
    const { container } = render(<GraphContextMenu {...props} />);
    await waitFor(() => {
      const splitBtn = container.querySelector("[data-testid='ctx-split-btn']") as HTMLButtonElement;
      expect(splitBtn.disabled).toBe(false);
    });
  });

  it("delete button text varies by selection count", () => {
    const props = defaultProps();
    props.selectionCount = 0;
    const { container, rerender } = render(<GraphContextMenu {...props} />);
    expect(container.querySelector("[data-testid='ctx-delete-btn']")!.textContent).toBe("Delete document");

    props.selectionCount = 3;
    rerender(<GraphContextMenu {...props} />);
    expect(container.querySelector("[data-testid='ctx-delete-btn']")!.textContent).toBe("Delete 3 documents");
  });

  it("delete button calls onDeleteRequest with nodeIds and labels", () => {
    const props = defaultProps();
    const { container } = render(<GraphContextMenu {...props} />);
    fireEvent.click(container.querySelector("[data-testid='ctx-delete-btn']")!);
    expect(props.onDeleteRequest).toHaveBeenCalledWith(["a.md"], ["a"]);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("export button shown only when onExportNetwork provided", () => {
    const props = defaultProps();
    props.onExportNetwork = undefined;
    const { container, rerender } = render(<GraphContextMenu {...props} />);
    expect(container.querySelector("[data-testid='ctx-export-btn']")).toBeNull();

    props.onExportNetwork = vi.fn();
    rerender(<GraphContextMenu {...props} />);
    expect(container.querySelector("[data-testid='ctx-export-btn']")).toBeTruthy();
  });

  it("clicking outside calls onClose", () => {
    const props = defaultProps();
    render(<GraphContextMenu {...props} />);
    fireEvent.pointerDown(document.body);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("pressing Escape calls onClose", () => {
    const props = defaultProps();
    render(<GraphContextMenu {...props} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("clicking inside menu does not dismiss", () => {
    const props = defaultProps();
    const { container } = render(<GraphContextMenu {...props} />);
    const menu = container.querySelector("[data-graph-context-menu]")!;
    fireEvent.pointerDown(menu);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("merge click reads pages for selected nodes and calls onMergeRequest", async () => {
    const props = defaultProps();
    props.selectionCount = 2;
    useGraphSelectionStore.setState({ selectedNodes: ["a.md", "b.md"] });
    const { container } = render(
      <GraphContextMenu {...props} />,
    );
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='ctx-merge-btn']")!);
    });
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onMergeRequest).toHaveBeenCalledWith([
      makePage("a.md", "# Title\n\nBody of a.md\n\n## Section\n\nMore text"),
      makePage("b.md", "# Title\n\nBody of b.md\n\n## Section\n\nMore text"),
    ]);
  });

  it("split click calls previewSplit and then onSplitRequest", async () => {
    const props = defaultProps();
    const { container } = render(<GraphContextMenu {...props} />);
    await waitFor(() => {
      const splitBtn = container.querySelector("[data-testid='ctx-split-btn']") as HTMLButtonElement;
      expect(splitBtn.disabled).toBe(false);
    });
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='ctx-split-btn']")!);
    });
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onSplitRequest).toHaveBeenCalledWith(
      { preamble: null, sections: [{ title: "Section", body: "More text", frontmatter: {} }] },
      "a.md",
    );
  });

  it("export click calls onExportNetwork and closes", () => {
    const props = defaultProps();
    props.onExportNetwork = vi.fn();
    const { container } = render(<GraphContextMenu {...props} />);
    fireEvent.click(container.querySelector("[data-testid='ctx-export-btn']")!);
    expect(props.onExportNetwork).toHaveBeenCalledWith("a.md");
    expect(props.onClose).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MindmapView } from "./MindmapView";
import { buildHeadingTree } from "../lib/headingTree";

function makeTree(body: string) {
  return buildHeadingTree(body);
}

const defaultProps = () => ({
  onNodeClick: vi.fn(),
  onNodeRename: vi.fn(),
  onNodeMove: vi.fn(),
});

describe("MindmapView", () => {
  it("renders SVG with correct number of node groups", () => {
    const tree = makeTree("# A\n## B\n## C");
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    const nodeGroups = container.querySelectorAll("[data-mindmap-node]");
    expect(nodeGroups).toHaveLength(3);
  });

  it("node text matches heading text", () => {
    const tree = makeTree("# Root\n## Child A\n## Child B");
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const texts = Array.from(container.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).toContain("Root");
    expect(texts).toContain("Child A");
    expect(texts).toContain("Child B");
  });

  it("renders links between parent and child nodes", () => {
    const tree = makeTree("# A\n## B");
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const links = container.querySelectorAll("[data-mindmap-link]");
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'No headings' message for empty tree", () => {
    const tree = makeTree("");
    render(<MindmapView tree={tree} {...defaultProps()} />);
    expect(screen.getByText("No headings")).toBeInTheDocument();
  });

  it("clicking a node calls onNodeClick with the correct node", async () => {
    const tree = makeTree("# A\n## B");
    const props = defaultProps();
    const { container } = render(<MindmapView tree={tree} {...props} />);
    const user = userEvent.setup();
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`);
    expect(nodeB).toBeTruthy();
    await user.click(nodeB!);
    expect(props.onNodeClick).toHaveBeenCalledWith(tree.children[0]!.children[0]!);
  });

  it("double-clicking a node shows a text input", async () => {
    const tree = makeTree("# A\n## B");
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const user = userEvent.setup();
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`);
    await user.dblClick(nodeB!);
    const input = container.querySelector("[data-mindmap-edit]") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("B");
  });

  it("pressing Enter in edit mode calls onNodeRename with new text", async () => {
    const tree = makeTree("# A\n## B");
    const props = defaultProps();
    const { container } = render(<MindmapView tree={tree} {...props} />);
    const user = userEvent.setup();
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`);
    await user.dblClick(nodeB!);
    const input = container.querySelector("[data-mindmap-edit]") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "New B{Enter}");
    expect(props.onNodeRename).toHaveBeenCalledWith(tree.children[0]!.children[0]!, "New B");
  });

  it("pressing Escape cancels edit mode without calling onNodeRename", async () => {
    const tree = makeTree("# A\n## B");
    const props = defaultProps();
    const { container } = render(<MindmapView tree={tree} {...props} />);
    const user = userEvent.setup();
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`);
    await user.dblClick(nodeB!);
    const input = container.querySelector("[data-mindmap-edit]") as HTMLInputElement;
    await user.type(input, "changed{Escape}");
    expect(props.onNodeRename).not.toHaveBeenCalled();
    expect(container.querySelector("[data-mindmap-edit]")).toBeNull();
  });
});

function firePointer(el: Element, type: string, overrides: Record<string, unknown> = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 0,
    clientY: 0,
    ...overrides,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(el, event);
}

describe("MindmapView drag-and-drop", () => {

  it("dragged node gets data-mindmap-dragging", () => {
    const tree = makeTree("# A\n## B\n## C");
    const props = defaultProps();
    const { container } = render(<MindmapView tree={tree} {...props} />);
    const svg = container.querySelector("[data-mindmap-svg]")!;
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`)!;

    firePointer(nodeB, "pointerdown", { clientX: 0, clientY: 0 });
    firePointer(svg, "pointermove", { clientX: 50, clientY: 50 });

    const dragging = container.querySelector("[data-mindmap-dragging]");
    expect(dragging).toBeTruthy();
    expect(dragging!.getAttribute("data-mindmap-node")).toBe(tree.children[0]!.children[0]!.id);
  });

  it("descendant gets data-mindmap-drop-invalid", () => {
    const tree = makeTree("# A\n## B\n### C");
    const props = defaultProps();
    const { container } = render(<MindmapView tree={tree} {...props} />);
    const svg = container.querySelector("[data-mindmap-svg]")!;
    const nodeA = container.querySelector(`[data-mindmap-node="${tree.children[0]!.id}"]`)!;

    firePointer(nodeA, "pointerdown", { clientX: 0, clientY: 0 });
    firePointer(svg, "pointermove", { clientX: 50, clientY: 50 });

    const invalidNodes = container.querySelectorAll("[data-mindmap-drop-invalid]");
    expect(invalidNodes.length).toBeGreaterThan(0);
  });

  it("SVG gets cursor-grabbing class during drag", () => {
    const tree = makeTree("# A\n## B\n## C");
    const props = defaultProps();
    const { container } = render(<MindmapView tree={tree} {...props} />);
    const svg = container.querySelector("[data-mindmap-svg]")!;
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`)!;

    expect(svg.classList.contains("cursor-grabbing")).toBe(false);

    firePointer(nodeB, "pointerdown", { clientX: 0, clientY: 0 });
    firePointer(svg, "pointermove", { clientX: 50, clientY: 50 });

    expect(svg.classList.contains("cursor-grabbing")).toBe(true);
  });

  it("ghost element appears during drag", () => {
    const tree = makeTree("# A\n## B\n## C");
    const props = defaultProps();
    const { container } = render(<MindmapView tree={tree} {...props} />);
    const svg = container.querySelector("[data-mindmap-svg]")!;
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`)!;

    expect(container.querySelector("[data-mindmap-ghost]")).toBeNull();

    firePointer(nodeB, "pointerdown", { clientX: 0, clientY: 0 });
    firePointer(svg, "pointermove", { clientX: 50, clientY: 50 });

    const ghost = container.querySelector("[data-mindmap-ghost]");
    expect(ghost).toBeTruthy();
    expect(ghost!.getAttribute("pointer-events")).toBe("none");
    expect(ghost!.querySelector("text")!.textContent).toBe("B");
  });

  it("ghost element disappears after drop", () => {
    const tree = makeTree("# A\n## B\n## C");
    const props = defaultProps();
    const { container } = render(<MindmapView tree={tree} {...props} />);
    const svg = container.querySelector("[data-mindmap-svg]")!;
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`)!;

    firePointer(nodeB, "pointerdown", { clientX: 0, clientY: 0 });
    firePointer(svg, "pointermove", { clientX: 50, clientY: 50 });
    expect(container.querySelector("[data-mindmap-ghost]")).toBeTruthy();

    firePointer(svg, "pointerup", { clientX: 50, clientY: 50 });
    expect(container.querySelector("[data-mindmap-ghost]")).toBeNull();
  });

  it("dragged node gets opacity-[0.3] during drag", () => {
    const tree = makeTree("# A\n## B\n## C");
    const props = defaultProps();
    const { container } = render(<MindmapView tree={tree} {...props} />);
    const svg = container.querySelector("[data-mindmap-svg]")!;
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`)!;

    firePointer(nodeB, "pointerdown", { clientX: 0, clientY: 0 });
    firePointer(svg, "pointermove", { clientX: 50, clientY: 50 });

    const dragging = container.querySelector("[data-mindmap-dragging]")!;
    const cls = dragging.getAttribute("class") ?? "";
    expect(cls).toContain("opacity-[0.3]");
    expect(cls).not.toContain("opacity-50");
  });

  it("short click still fires onNodeClick", () => {
    const tree = makeTree("# A\n## B");
    const props = defaultProps();
    const { container } = render(<MindmapView tree={tree} {...props} />);
    const svg = container.querySelector("[data-mindmap-svg]")!;
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`)!;

    firePointer(nodeB, "pointerdown", { clientX: 5, clientY: 5 });
    firePointer(svg, "pointerup", { clientX: 6, clientY: 6 });
    fireEvent.click(nodeB);

    expect(props.onNodeClick).toHaveBeenCalledWith(tree.children[0]!.children[0]!);
    expect(props.onNodeMove).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MindmapView } from "./MindmapView";
import { buildHeadingTree } from "../lib/headingTree";
import { extractHeadings } from "../lib/headings";

function makeTree(body: string) {
  return buildHeadingTree(extractHeadings(body));
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

  it("right-clicking a node shows context menu with Edit option", () => {
    const tree = makeTree("# A\n## B");
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`)!;
    fireEvent.contextMenu(nodeB);
    const menu = container.querySelector("[data-mindmap-context-menu]");
    expect(menu).toBeTruthy();
    expect(menu!.textContent).toContain("Edit");
  });

  it("clicking Edit in context menu enters edit mode", () => {
    const tree = makeTree("# A\n## B");
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`)!;
    fireEvent.contextMenu(nodeB);
    const editItem = container.querySelector("[data-mindmap-context-edit]") as HTMLElement;
    expect(editItem).toBeTruthy();
    fireEvent.click(editItem);
    const input = container.querySelector("[data-mindmap-edit]") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("B");
    expect(container.querySelector("[data-mindmap-context-menu]")).toBeNull();
  });

  it("pressing Enter in edit mode calls onNodeRename with new text", async () => {
    const tree = makeTree("# A\n## B");
    const props = defaultProps();
    const { container } = render(<MindmapView tree={tree} {...props} />);
    const user = userEvent.setup();
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`)!;
    fireEvent.contextMenu(nodeB);
    fireEvent.click(container.querySelector("[data-mindmap-context-edit]")!);
    const input = container.querySelector("[data-mindmap-edit]") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "New B{Enter}");
    expect(props.onNodeRename).toHaveBeenCalledWith(tree.children[0]!.children[0]!, "New B");
  });

  it("pressing Escape in edit mode cancels without calling onNodeRename", async () => {
    const tree = makeTree("# A\n## B");
    const props = defaultProps();
    const { container } = render(<MindmapView tree={tree} {...props} />);
    const user = userEvent.setup();
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`)!;
    fireEvent.contextMenu(nodeB);
    fireEvent.click(container.querySelector("[data-mindmap-context-edit]")!);
    const input = container.querySelector("[data-mindmap-edit]") as HTMLInputElement;
    await user.type(input, "changed{Escape}");
    expect(props.onNodeRename).not.toHaveBeenCalled();
    expect(container.querySelector("[data-mindmap-edit]")).toBeNull();
  });

  it("clicking outside the context menu dismisses it", () => {
    const tree = makeTree("# A\n## B");
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`)!;
    fireEvent.contextMenu(nodeB);
    expect(container.querySelector("[data-mindmap-context-menu]")).toBeTruthy();
    fireEvent.pointerDown(container.querySelector("svg")!);
    expect(container.querySelector("[data-mindmap-context-menu]")).toBeNull();
  });

  it("pressing Escape dismisses the context menu", () => {
    const tree = makeTree("# A\n## B");
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`)!;
    fireEvent.contextMenu(nodeB);
    expect(container.querySelector("[data-mindmap-context-menu]")).toBeTruthy();
    fireEvent.keyDown(container.querySelector("[data-mindmap-context-menu]")!, { key: "Escape" });
    expect(container.querySelector("[data-mindmap-context-menu]")).toBeNull();
  });

  it("double-clicking a node does NOT enter edit mode", async () => {
    const tree = makeTree("# A\n## B");
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const user = userEvent.setup();
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`)!;
    await user.dblClick(nodeB);
    expect(container.querySelector("[data-mindmap-edit]")).toBeNull();
  });

  it("short-text node has a narrower rect than long-text node", () => {
    const tree = makeTree("# Hi\n## A much longer heading title here");
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const nodes = container.querySelectorAll("[data-mindmap-node]");
    const rectShort = nodes[0]!.querySelector("rect")!;
    const rectLong = nodes[1]!.querySelector("rect")!;
    const wShort = Number(rectShort.getAttribute("width"));
    const wLong = Number(rectLong.getAttribute("width"));
    expect(wLong).toBeGreaterThan(wShort);
  });

  it("very long text wraps into multiple lines", () => {
    const longHeading = "# " + "A".repeat(200);
    const tree = makeTree(longHeading);
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const textEl = container.querySelector("[data-mindmap-node] text")!;
    const tspans = textEl.querySelectorAll("tspan");
    expect(tspans.length).toBeGreaterThan(1);
    const fullText = Array.from(tspans).map((t) => t.textContent).join("");
    expect(fullText).toBe("A".repeat(200));
  });

  it("short text renders a single tspan", () => {
    const tree = makeTree("# Hi");
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const textEl = container.querySelector("[data-mindmap-node] text")!;
    const tspans = textEl.querySelectorAll("tspan");
    expect(tspans).toHaveLength(1);
    expect(tspans[0]!.textContent).toBe("Hi");
  });

  it("node rect is taller for wrapped text", () => {
    const tree = makeTree("# Hi\n## " + "word ".repeat(30));
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const nodes = container.querySelectorAll("[data-mindmap-node]");
    const rectShort = nodes[0]!.querySelector("rect")!;
    const rectLong = nodes[1]!.querySelector("rect")!;
    const hShort = Number(rectShort.getAttribute("height"));
    const hLong = Number(rectLong.getAttribute("height"));
    expect(hLong).toBeGreaterThan(hShort);
  });

  it("clipPath rect height matches node rect height", () => {
    const longText = "word ".repeat(30).trim();
    const tree = makeTree("# " + longText);
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const nodeRect = container.querySelector("[data-mindmap-node] rect")!;
    const nodeH = Number(nodeRect.getAttribute("height"));
    const nodeId = container.querySelector("[data-mindmap-node]")!.getAttribute("data-mindmap-node")!;
    const clipRect = container.querySelector(`#node-clip-${nodeId} rect`)!;
    const clipH = Number(clipRect.getAttribute("height"));
    expect(clipH).toBe(nodeH);
  });

  it("display text is clipped to node bounds via clipPath", () => {
    const tree = makeTree("# A\n## B");
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const textEl = container.querySelector("[data-mindmap-node] text")!;
    expect(textEl.getAttribute("clip-path")).toMatch(/url\(#node-clip-/);
  });

  it("edit input is rendered as HTML overlay, not inside SVG foreignObject", () => {
    const tree = makeTree("# A\n## B");
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`)!;
    fireEvent.contextMenu(nodeB);
    fireEvent.click(container.querySelector("[data-mindmap-context-edit]")!);
    const input = container.querySelector("[data-mindmap-edit]") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.closest("svg")).toBeNull();
    expect(input.closest("[class*='overflow-hidden']")).toBeTruthy();
  });

  it("context menu does not appear during drag", () => {
    const tree = makeTree("# A\n## B\n## C");
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const svg = container.querySelector("[data-mindmap-svg]")!;
    const nodeB = container.querySelector(`[data-mindmap-node="${tree.children[0]!.children[0]!.id}"]`)!;
    firePointer(nodeB, "pointerdown", { clientX: 0, clientY: 0 });
    firePointer(svg, "pointermove", { clientX: 50, clientY: 50 });
    fireEvent.contextMenu(nodeB);
    expect(container.querySelector("[data-mindmap-context-menu]")).toBeNull();
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

  it("SVG has no viewBox attribute", () => {
    const tree = makeTree("# A\n## B");
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBeNull();
  });

  it("zoom control buttons exist", () => {
    const tree = makeTree("# A\n## B");
    const { container } = render(<MindmapView tree={tree} {...defaultProps()} />);
    expect(container.querySelector("[data-mindmap-zoom-in]")).toBeTruthy();
    expect(container.querySelector("[data-mindmap-zoom-out]")).toBeTruthy();
    expect(container.querySelector("[data-mindmap-zoom-fit]")).toBeTruthy();
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

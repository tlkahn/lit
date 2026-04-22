import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HeadingQuickSwitcher } from "./HeadingQuickSwitcher";
import type { Heading } from "../lib/headings";

const headings: Heading[] = [
  { level: 1, text: "Introduction", line: 0 },
  { level: 2, text: "Getting Started", line: 5 },
  { level: 3, text: "Installation", line: 10 },
  { level: 2, text: "Advanced Usage", line: 20 },
];

describe("HeadingQuickSwitcher", () => {
  let onClose: ReturnType<typeof vi.fn>;
  let onSelect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
    onSelect = vi.fn();
  });

  it("renders nothing when open=false", () => {
    const { container } = render(
      <HeadingQuickSwitcher open={false} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders overlay with backdrop when open=true", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    expect(screen.getByTestId("quick-switcher-backdrop")).toBeInTheDocument();
    expect(screen.getByTestId("quick-switcher-panel")).toBeInTheDocument();
  });

  it("input is auto-focused on open", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    expect(screen.getByTestId("quick-switcher-input")).toHaveFocus();
  });

  it("shows all headings with empty query", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    const items = screen.getAllByTestId("quick-switcher-item");
    expect(items).toHaveLength(4);
    expect(items[0]!.textContent).toContain("Introduction");
    expect(items[1]!.textContent).toContain("Getting Started");
  });

  it("indents headings by level", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    const items = screen.getAllByTestId("quick-switcher-item");
    expect(items[0]!.style.paddingLeft).toBe("16px");
    expect(items[1]!.style.paddingLeft).toBe("28px");
    expect(items[2]!.style.paddingLeft).toBe("40px");
  });

  it("typing filters headings via fuzzy match", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    fireEvent.change(screen.getByTestId("quick-switcher-input"), { target: { value: "instal" } });
    const items = screen.getAllByTestId("quick-switcher-item");
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain("Installation");
  });

  it("shows 'No matches' when filter eliminates all", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    fireEvent.change(screen.getByTestId("quick-switcher-input"), { target: { value: "zzzzz" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("shows 'No headings' when headings array is empty", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={[]} />,
    );
    expect(screen.getByText("No headings")).toBeInTheDocument();
  });

  it("first item selected by default", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    const items = screen.getAllByTestId("quick-switcher-item");
    expect(items[0]!.getAttribute("data-active")).toBe("true");
  });

  it("ArrowDown moves selection", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    fireEvent.keyDown(screen.getByTestId("quick-switcher-input"), { key: "ArrowDown" });
    const items = screen.getAllByTestId("quick-switcher-item");
    expect(items[1]!.getAttribute("data-active")).toBe("true");
  });

  it("ArrowUp wraps to last item from first", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    fireEvent.keyDown(screen.getByTestId("quick-switcher-input"), { key: "ArrowUp" });
    const items = screen.getAllByTestId("quick-switcher-item");
    expect(items[3]!.getAttribute("data-active")).toBe("true");
  });

  it("ArrowDown wraps to first item from last", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    const input = screen.getByTestId("quick-switcher-input");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const items = screen.getAllByTestId("quick-switcher-item");
    expect(items[0]!.getAttribute("data-active")).toBe("true");
  });

  it("Enter calls onSelect with line then onClose", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    fireEvent.keyDown(screen.getByTestId("quick-switcher-input"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(0);
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape calls onClose", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    fireEvent.keyDown(screen.getByTestId("quick-switcher-input"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clicking a heading calls onSelect + onClose", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    const items = screen.getAllByTestId("quick-switcher-item");
    fireEvent.click(items[2]!);
    expect(onSelect).toHaveBeenCalledWith(10);
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking backdrop calls onClose", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    fireEvent.click(screen.getByTestId("quick-switcher-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });

  it("matched characters are highlighted with <mark> elements", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    fireEvent.change(screen.getByTestId("quick-switcher-input"), { target: { value: "int" } });
    const items = screen.getAllByTestId("quick-switcher-item");
    const marks = items[0]!.querySelectorAll("mark");
    expect(marks.length).toBeGreaterThan(0);
  });

  it("typing resets selection to first item", () => {
    render(
      <HeadingQuickSwitcher open={true} onClose={onClose} onSelect={onSelect} headings={headings} />,
    );
    const input = screen.getByTestId("quick-switcher-input");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.change(input, { target: { value: "a" } });
    const items = screen.getAllByTestId("quick-switcher-item");
    expect(items[0]!.getAttribute("data-active")).toBe("true");
  });
});

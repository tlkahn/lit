import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LinkPicker } from "./LinkPicker";
import type { CardboxAnnotation } from "../lib/ipc";

// jsdom doesn't implement scrollIntoView
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const MOCK_ANNOTATIONS: CardboxAnnotation[] = [
  {
    uuid: "src",
    annotation_type: "note",
    certainty: "neutral",
    body: "Source card",
    date: null,
    source_page_id: "a.md",
    source_page_title: "Alpha",
    source_line: 1,
    char_start: 0,
    char_end: 10,
    scope_kind: "words",
    scope_value: "1",
    original: null,
  },
  {
    uuid: "linked",
    annotation_type: "question",
    certainty: "tentative",
    body: "Already linked",
    date: null,
    source_page_id: "b.md",
    source_page_title: "Beta",
    source_line: 2,
    char_start: 0,
    char_end: 10,
    scope_kind: "words",
    scope_value: "1",
    original: null,
  },
  {
    uuid: "candidate-1",
    annotation_type: "note",
    certainty: "neutral",
    body: "Silk Road flourished during the Tang dynasty",
    date: null,
    source_page_id: "c.md",
    source_page_title: "History",
    source_line: 3,
    char_start: 0,
    char_end: 10,
    scope_kind: "words",
    scope_value: "1",
    original: "ancient trade",
  },
  {
    uuid: "candidate-2",
    annotation_type: "todo",
    certainty: "neutral",
    body: "Review bibliography",
    date: null,
    source_page_id: "d.md",
    source_page_title: "Tasks",
    source_line: 4,
    char_start: 0,
    char_end: 10,
    scope_kind: "words",
    scope_value: "1",
    original: null,
  },
];

const defaultProps = {
  open: true,
  sourceUuid: "src",
  annotations: MOCK_ANNOTATIONS,
  existingLinks: ["linked"],
  onSelect: vi.fn(),
  onClose: vi.fn(),
};

describe("LinkPicker", () => {
  it("renders when open", () => {
    render(<LinkPicker {...defaultProps} />);
    expect(screen.getByTestId("link-picker-backdrop")).toBeTruthy();
    expect(screen.getByTestId("link-picker-panel")).toBeTruthy();
  });

  it("does not render when closed", () => {
    render(<LinkPicker {...defaultProps} open={false} />);
    expect(screen.queryByTestId("link-picker-backdrop")).toBeNull();
  });

  it("auto-focuses search input", () => {
    render(<LinkPicker {...defaultProps} />);
    const input = screen.getByTestId("link-picker-input");
    expect(document.activeElement).toBe(input);
  });

  it("excludes source card from results", () => {
    render(<LinkPicker {...defaultProps} />);
    const results = screen.getAllByTestId("link-picker-result");
    const texts = results.map((r) => r.textContent);
    expect(texts.some((t) => t?.includes("Source card"))).toBe(false);
  });

  it("excludes already-linked cards", () => {
    render(<LinkPicker {...defaultProps} />);
    const results = screen.getAllByTestId("link-picker-result");
    const texts = results.map((r) => r.textContent);
    expect(texts.some((t) => t?.includes("Already linked"))).toBe(false);
  });

  it("shows only eligible candidates", () => {
    render(<LinkPicker {...defaultProps} />);
    const results = screen.getAllByTestId("link-picker-result");
    // Only candidate-1 and candidate-2 should remain (src and linked are excluded)
    expect(results).toHaveLength(2);
  });

  it("filters by search query on body", () => {
    render(<LinkPicker {...defaultProps} />);
    const input = screen.getByTestId("link-picker-input");
    fireEvent.change(input, { target: { value: "silk" } });
    const results = screen.getAllByTestId("link-picker-result");
    expect(results).toHaveLength(1);
    expect(results[0]!.textContent).toContain("Silk Road");
  });

  it("filters by search query on original text", () => {
    render(<LinkPicker {...defaultProps} />);
    const input = screen.getByTestId("link-picker-input");
    fireEvent.change(input, { target: { value: "ancient" } });
    const results = screen.getAllByTestId("link-picker-result");
    expect(results).toHaveLength(1);
    expect(results[0]!.textContent).toContain("Silk Road");
  });

  it("filters by search query on source_page_title", () => {
    render(<LinkPicker {...defaultProps} />);
    const input = screen.getByTestId("link-picker-input");
    fireEvent.change(input, { target: { value: "tasks" } });
    const results = screen.getAllByTestId("link-picker-result");
    expect(results).toHaveLength(1);
    expect(results[0]!.textContent).toContain("Review bibliography");
  });

  it("shows 'No results' when query matches nothing", () => {
    render(<LinkPicker {...defaultProps} />);
    const input = screen.getByTestId("link-picker-input");
    fireEvent.change(input, { target: { value: "zzzzzzz" } });
    expect(screen.queryAllByTestId("link-picker-result")).toHaveLength(0);
    expect(screen.getByText("No results")).toBeTruthy();
  });

  it("shows 'No candidates available' when no candidates and no query", () => {
    render(
      <LinkPicker
        {...defaultProps}
        annotations={[MOCK_ANNOTATIONS[0]!]} // only the source card
        existingLinks={[]}
      />,
    );
    expect(screen.queryAllByTestId("link-picker-result")).toHaveLength(0);
    expect(screen.getByText("No candidates available")).toBeTruthy();
  });

  it("Enter selects highlighted card and closes picker", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<LinkPicker {...defaultProps} onSelect={onSelect} onClose={onClose} />);
    const input = screen.getByTestId("link-picker-input");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("candidate-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape closes picker", () => {
    const onClose = vi.fn();
    render(<LinkPicker {...defaultProps} onClose={onClose} />);
    const input = screen.getByTestId("link-picker-input");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking backdrop closes picker", () => {
    const onClose = vi.fn();
    render(<LinkPicker {...defaultProps} onClose={onClose} />);
    const backdrop = screen.getByTestId("link-picker-backdrop");
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking panel does not close picker", () => {
    const onClose = vi.fn();
    render(<LinkPicker {...defaultProps} onClose={onClose} />);
    const panel = screen.getByTestId("link-picker-panel");
    fireEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("arrow keys navigate results", () => {
    render(<LinkPicker {...defaultProps} />);
    const input = screen.getByTestId("link-picker-input");
    const results = screen.getAllByTestId("link-picker-result");

    // First item is initially active
    expect(results[0]!.dataset.active).toBe("true");
    expect(results[1]!.dataset.active).toBe("false");

    // ArrowDown moves to next
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const updatedResults = screen.getAllByTestId("link-picker-result");
    expect(updatedResults[0]!.dataset.active).toBe("false");
    expect(updatedResults[1]!.dataset.active).toBe("true");

    // ArrowUp moves back
    fireEvent.keyDown(input, { key: "ArrowUp" });
    const resetResults = screen.getAllByTestId("link-picker-result");
    expect(resetResults[0]!.dataset.active).toBe("true");
  });

  it("arrow down wraps from last to first", () => {
    render(<LinkPicker {...defaultProps} />);
    const input = screen.getByTestId("link-picker-input");

    // Move to last item (index 1 of 2)
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // Wrap to first
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const results = screen.getAllByTestId("link-picker-result");
    expect(results[0].dataset.active).toBe("true");
  });

  it("arrow up wraps from first to last", () => {
    render(<LinkPicker {...defaultProps} />);
    const input = screen.getByTestId("link-picker-input");

    // From first (index 0), ArrowUp wraps to last
    fireEvent.keyDown(input, { key: "ArrowUp" });
    const results = screen.getAllByTestId("link-picker-result");
    expect(results[results.length - 1].dataset.active).toBe("true");
  });

  it("clicking a result selects it and closes picker", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<LinkPicker {...defaultProps} onSelect={onSelect} onClose={onClose} />);
    const results = screen.getAllByTestId("link-picker-result");
    fireEvent.click(results[1]);
    expect(onSelect).toHaveBeenCalledWith("candidate-2");
    expect(onClose).toHaveBeenCalled();
  });

  it("resets query and active index when re-opened", () => {
    const { rerender } = render(<LinkPicker {...defaultProps} />);
    const input = screen.getByTestId("link-picker-input");
    // Type a query and navigate
    fireEvent.change(input, { target: { value: "silk" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    // Close and re-open
    rerender(<LinkPicker {...defaultProps} open={false} />);
    rerender(<LinkPicker {...defaultProps} open={true} />);

    const newInput = screen.getByTestId("link-picker-input");
    expect((newInput as HTMLInputElement).value).toBe("");
    const results = screen.getAllByTestId("link-picker-result");
    expect(results[0].dataset.active).toBe("true");
  });

  it("resets active index when query changes", () => {
    render(<LinkPicker {...defaultProps} />);
    const input = screen.getByTestId("link-picker-input");

    // Navigate down
    fireEvent.keyDown(input, { key: "ArrowDown" });
    let results = screen.getAllByTestId("link-picker-result");
    expect(results[1].dataset.active).toBe("true");

    // Type a query -- active index should reset to 0
    fireEvent.change(input, { target: { value: "review" } });
    results = screen.getAllByTestId("link-picker-result");
    expect(results[0].dataset.active).toBe("true");
  });

  it("displays type icon badge for each result", () => {
    render(<LinkPicker {...defaultProps} />);
    const results = screen.getAllByTestId("link-picker-result");
    // candidate-1 is "note" -> icon "N"
    expect(results[0].textContent).toContain("N");
    // candidate-2 is "todo" -> icon "T"
    expect(results[1].textContent).toContain("T");
  });

  it("displays source_page_title for each result", () => {
    render(<LinkPicker {...defaultProps} />);
    const results = screen.getAllByTestId("link-picker-result");
    expect(results[0].textContent).toContain("History");
    expect(results[1].textContent).toContain("Tasks");
  });

  it("caps results at 50", () => {
    const manyAnnotations: CardboxAnnotation[] = Array.from({ length: 60 }, (_, i) => ({
      uuid: `ann-${i}`,
      annotation_type: "note",
      certainty: "neutral",
      body: `Annotation ${i}`,
      date: null,
      source_page_id: "x.md",
      source_page_title: "X",
      source_line: i,
      char_start: 0,
      char_end: 10,
      scope_kind: "words",
      scope_value: "1",
      original: null,
    }));

    render(
      <LinkPicker
        open={true}
        sourceUuid="none"
        annotations={manyAnnotations}
        existingLinks={[]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const results = screen.getAllByTestId("link-picker-result");
    expect(results).toHaveLength(50);
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LinkPicker } from "./LinkPicker";
import type { CardboxAnnotation } from "../lib/ipc";

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

  it("filters by search query", () => {
    render(<LinkPicker {...defaultProps} />);
    const input = screen.getByTestId("link-picker-input");
    fireEvent.change(input, { target: { value: "silk" } });
    const results = screen.getAllByTestId("link-picker-result");
    expect(results).toHaveLength(1);
    expect(results[0]!.textContent).toContain("Silk Road");
  });

  it("Enter selects highlighted card", () => {
    const onSelect = vi.fn();
    render(<LinkPicker {...defaultProps} onSelect={onSelect} />);
    const input = screen.getByTestId("link-picker-input");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("candidate-1");
  });

  it("Escape closes picker", () => {
    const onClose = vi.fn();
    render(<LinkPicker {...defaultProps} onClose={onClose} />);
    const input = screen.getByTestId("link-picker-input");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("arrow keys navigate results", () => {
    render(<LinkPicker {...defaultProps} />);
    const input = screen.getByTestId("link-picker-input");
    const results = screen.getAllByTestId("link-picker-result");

    expect(results[0]!.dataset.active).toBe("true");
    expect(results[1]!.dataset.active).toBe("false");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const updatedResults = screen.getAllByTestId("link-picker-result");
    expect(updatedResults[0]!.dataset.active).toBe("false");
    expect(updatedResults[1]!.dataset.active).toBe("true");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    const resetResults = screen.getAllByTestId("link-picker-result");
    expect(resetResults[0]!.dataset.active).toBe("true");
  });

  it("does not render when closed", () => {
    render(<LinkPicker {...defaultProps} open={false} />);
    expect(screen.queryByTestId("link-picker-backdrop")).toBeNull();
  });
});

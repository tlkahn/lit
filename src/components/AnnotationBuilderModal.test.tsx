import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnnotationBuilderModal } from "./AnnotationBuilderModal";

describe("AnnotationBuilderModal", () => {
  let onClose: ReturnType<typeof vi.fn>;
  let onInsert: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
    onInsert = vi.fn();
  });

  it("renders panel when mounted", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    expect(screen.getByTestId("annotation-builder-panel")).toBeInTheDocument();
  });

  it("renders modal with fields", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    expect(screen.getByTestId("annotation-builder-backdrop")).toBeInTheDocument();
    expect(screen.getByTestId("annotation-builder-panel")).toBeInTheDocument();
    expect(screen.getByTestId("annotation-type-select")).toBeInTheDocument();
    expect(screen.getByTestId("annotation-certainty-select")).toBeInTheDocument();
    expect(screen.getByTestId("annotation-scope-select")).toBeInTheDocument();
    expect(screen.getByTestId("annotation-body-input")).toBeInTheDocument();
    expect(screen.getByTestId("annotation-date-input")).toBeInTheDocument();
    expect(screen.getByTestId("annotation-preview")).toBeInTheDocument();
  });

  it("type dropdown changes update live preview", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    const typeSelect = screen.getByTestId("annotation-type-select");
    fireEvent.change(typeSelect, { target: { value: "note" } });
    const preview = screen.getByTestId("annotation-preview");
    expect(preview.textContent).toContain("n");
  });

  it("certainty changes update preview", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    fireEvent.change(screen.getByTestId("annotation-type-select"), { target: { value: "note" } });
    fireEvent.change(screen.getByTestId("annotation-certainty-select"), { target: { value: "tentative" } });
    const preview = screen.getByTestId("annotation-preview");
    expect(preview.textContent).toContain("n?");
  });

  it("scope dropdown changes update preview", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    fireEvent.change(screen.getByTestId("annotation-type-select"), { target: { value: "note" } });
    fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "paragraph" } });
    const preview = screen.getByTestId("annotation-preview");
    expect(preview.textContent).toContain("\\p");
  });

  it("anchor text field appears only when scope = anchor", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    expect(screen.queryByTestId("annotation-anchor-input")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "anchor" } });
    expect(screen.getByTestId("annotation-anchor-input")).toBeInTheDocument();
  });

  it("body textarea changes update preview", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    fireEvent.change(screen.getByTestId("annotation-type-select"), { target: { value: "note" } });
    fireEvent.change(screen.getByTestId("annotation-body-input"), { target: { value: "hello world" } });
    const preview = screen.getByTestId("annotation-preview");
    expect(preview.textContent).toContain("hello world");
  });

  it("date input changes update preview", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    fireEvent.change(screen.getByTestId("annotation-type-select"), { target: { value: "note" } });
    fireEvent.change(screen.getByTestId("annotation-body-input"), { target: { value: "x" } });
    fireEvent.change(screen.getByTestId("annotation-date-input"), { target: { value: "2026-03" } });
    const preview = screen.getByTestId("annotation-preview");
    expect(preview.textContent).toContain("@2026-03");
  });

  it("insert button calls onInsert with correct DSL", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    fireEvent.change(screen.getByTestId("annotation-type-select"), { target: { value: "note" } });
    fireEvent.change(screen.getByTestId("annotation-body-input"), { target: { value: "test body" } });
    fireEvent.click(screen.getByTestId("annotation-insert-btn"));
    expect(onInsert).toHaveBeenCalledWith("%%! n | test body %%");
  });

  it("cancel button calls onClose", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    fireEvent.click(screen.getByTestId("annotation-cancel-btn"));
    expect(onClose).toHaveBeenCalled();
  });

  it("ESC key calls onClose", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("preview shows generateDsl output", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    fireEvent.change(screen.getByTestId("annotation-type-select"), { target: { value: "question" } });
    fireEvent.change(screen.getByTestId("annotation-certainty-select"), { target: { value: "firm" } });
    fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "words" } });
    fireEvent.change(screen.getByTestId("annotation-body-input"), { target: { value: "is this right?" } });
    const preview = screen.getByTestId("annotation-preview");
    expect(preview.textContent).toBe("%%! q! _ | is this right? %%");
  });

  it("initialFields prop pre-fills form", () => {
    render(
      <AnnotationBuilderModal
        onClose={onClose}
        onInsert={onInsert}
        initialFields={{ type: "todo", certainty: "firm", body: "fix this" }}
      />,
    );
    const preview = screen.getByTestId("annotation-preview");
    expect(preview.textContent).toBe("%%! todo! | fix this %%");
  });

  it("scope count input appears for words/sentence/paragraph/page", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "words" } });
    expect(screen.getByTestId("annotation-scope-count")).toBeInTheDocument();
  });

  it("resets to defaults when remounted", () => {
    const { unmount } = render(
      <AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />,
    );
    fireEvent.change(screen.getByTestId("annotation-type-select"), { target: { value: "note" } });
    fireEvent.change(screen.getByTestId("annotation-body-input"), { target: { value: "hello" } });
    unmount();

    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    expect(screen.getByTestId("annotation-type-select")).toHaveValue("");
    expect(screen.getByTestId("annotation-body-input")).toHaveValue("");
    expect(screen.getByTestId("annotation-preview").textContent).toBe("%%!  %%");
  });

  it("uses initialFields on each fresh mount", () => {
    const { unmount } = render(
      <AnnotationBuilderModal
        onClose={onClose}
        onInsert={onInsert}
        initialFields={{ type: "todo", body: "first" }}
      />,
    );
    expect(screen.getByTestId("annotation-preview").textContent).toContain("first");
    unmount();

    render(
      <AnnotationBuilderModal
        onClose={onClose}
        onInsert={onInsert}
        initialFields={{ type: "note", body: "second" }}
      />,
    );
    expect(screen.getByTestId("annotation-preview").textContent).toContain("second");
    expect(screen.getByTestId("annotation-type-select")).toHaveValue("note");
  });
});

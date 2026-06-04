import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnnotationBuilderModal } from "./AnnotationBuilderModal";
import { usePreferencesStore } from "../stores/preferences";
import type { AnnotationBuilderDefaults } from "../lib/annotationBuilderDefaults";
import { mockInvoke } from "../test/tauri-mock";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("AnnotationBuilderModal", () => {
  let onClose: ReturnType<typeof vi.fn>;
  let onInsert: ReturnType<typeof vi.fn>;
  let onEditRaw: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01"));
    onClose = vi.fn();
    onInsert = vi.fn();
    onEditRaw = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(screen.getByTestId("annotation-id-input")).toBeInTheDocument();
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
    // type defaults to "note", clear the auto-generated id so we can test a known shape
    fireEvent.change(screen.getByTestId("annotation-id-input"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("annotation-body-input"), { target: { value: "test body" } });
    fireEvent.click(screen.getByTestId("annotation-insert-btn"));
    expect(onInsert).toHaveBeenCalledWith("<!--- n | test body @2026-06-01 --->");
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

  it("Cmd+Enter calls onInsert with current preview", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    fireEvent.change(screen.getByTestId("annotation-id-input"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("annotation-body-input"), { target: { value: "confirm test" } });
    fireEvent.keyDown(document, { key: "Enter", metaKey: true });
    expect(onInsert).toHaveBeenCalledWith("<!--- n | confirm test @2026-06-01 --->");
  });

  it("Ctrl+Enter calls onInsert with current preview", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    fireEvent.change(screen.getByTestId("annotation-id-input"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("annotation-body-input"), { target: { value: "confirm test" } });
    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    expect(onInsert).toHaveBeenCalledWith("<!--- n | confirm test @2026-06-01 --->");
  });

  it("preview shows generateDsl output", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    // Clear auto-generated id so the preview is predictable
    fireEvent.change(screen.getByTestId("annotation-id-input"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("annotation-type-select"), { target: { value: "question" } });
    fireEvent.change(screen.getByTestId("annotation-certainty-select"), { target: { value: "firm" } });
    fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "words" } });
    fireEvent.change(screen.getByTestId("annotation-body-input"), { target: { value: "is this right?" } });
    const preview = screen.getByTestId("annotation-preview");
    expect(preview.textContent).toBe("<!--- q! _ | is this right? @2026-06-01 --->");
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
    // id and date auto-filled: [uuid] and @2026-06-01
    expect(preview.textContent).toMatch(/^<!---\[[0-9a-f-]{36}\] todo! \| fix this @2026-06-01 --->$/);
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
    fireEvent.change(screen.getByTestId("annotation-type-select"), { target: { value: "question" } });
    fireEvent.change(screen.getByTestId("annotation-body-input"), { target: { value: "hello" } });
    unmount();

    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    expect(screen.getByTestId("annotation-type-select")).toHaveValue("note");
    expect(screen.getByTestId("annotation-body-input")).toHaveValue("");
    expect(screen.getByTestId("annotation-date-input")).toHaveValue("2026-06-01");
    const idInput = screen.getByTestId("annotation-id-input") as HTMLInputElement;
    expect(idInput.value).toMatch(UUID_RE);
    const preview = screen.getByTestId("annotation-preview").textContent!;
    expect(preview).toMatch(/^<!---\[[0-9a-f-]{36}\] n @2026-06-01 --->$/);
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
    expect(screen.getByTestId("annotation-date-input")).toHaveValue("2026-06-01");
  });

  it("select elements do not carry ad-hoc border/background classes", () => {
    render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
    const selects = [
      screen.getByTestId("annotation-type-select"),
      screen.getByTestId("annotation-certainty-select"),
      screen.getByTestId("annotation-scope-select"),
    ];
    for (const select of selects) {
      expect(select.className).not.toContain("border-border-primary");
      expect(select.className).not.toContain("bg-bg-secondary");
    }
  });

  describe("edit mode", () => {
    it("mode='edit' renders 'Update' button text", () => {
      render(
        <AnnotationBuilderModal onClose={onClose} onInsert={onInsert} mode="edit" />,
      );
      expect(screen.getByTestId("annotation-insert-btn").textContent).toBe("Update");
    });

    it("mode='create' renders 'Insert' button text", () => {
      render(
        <AnnotationBuilderModal onClose={onClose} onInsert={onInsert} mode="create" />,
      );
      expect(screen.getByTestId("annotation-insert-btn").textContent).toBe("Insert");
    });

    it("no mode renders 'Insert' button text", () => {
      render(
        <AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />,
      );
      expect(screen.getByTestId("annotation-insert-btn").textContent).toBe("Insert");
    });

    it("mode='edit' with initialFields pre-fills all fields correctly", () => {
      render(
        <AnnotationBuilderModal
          onClose={onClose}
          onInsert={onInsert}
          mode="edit"
          initialFields={{
            type: "question",
            certainty: "tentative",
            scope: { kind: "words", value: 2 },
            body: "is this right?",
            date: "2026-03",
          }}
        />,
      );
      expect(screen.getByTestId("annotation-type-select")).toHaveValue("question");
      expect(screen.getByTestId("annotation-certainty-select")).toHaveValue("tentative");
      expect(screen.getByTestId("annotation-scope-select")).toHaveValue("words");
      expect(screen.getByTestId("annotation-scope-count")).toHaveValue(2);
      expect(screen.getByTestId("annotation-body-input")).toHaveValue("is this right?");
      expect(screen.getByTestId("annotation-date-input")).toHaveValue("2026-03");
    });

    it("'Update' click calls onInsert with generated DSL", () => {
      render(
        <AnnotationBuilderModal
          onClose={onClose}
          onInsert={onInsert}
          mode="edit"
          initialFields={{ type: "note", body: "edited" }}
        />,
      );
      fireEvent.click(screen.getByTestId("annotation-insert-btn"));
      expect(onInsert).toHaveBeenCalledWith("<!--- n | edited --->");
    });
  });

  describe("Edit Raw button", () => {
    it("renders Edit Raw button in create mode", () => {
      render(
        <AnnotationBuilderModal onClose={onClose} onInsert={onInsert} onEditRaw={onEditRaw} />,
      );
      expect(screen.getByTestId("annotation-edit-raw-btn")).toBeInTheDocument();
    });

    it("renders Edit Raw button in edit mode", () => {
      render(
        <AnnotationBuilderModal onClose={onClose} onInsert={onInsert} onEditRaw={onEditRaw} mode="edit" />,
      );
      expect(screen.getByTestId("annotation-edit-raw-btn")).toBeInTheDocument();
    });

    it("clicking Edit Raw calls onEditRaw with mode, draftDsl, and originalRange", () => {
      const originalRange = { from: 10, to: 25 };
      render(
        <AnnotationBuilderModal
          onClose={onClose}
          onInsert={onInsert}
          onEditRaw={onEditRaw}
          mode="edit"
          originalRange={originalRange}
          initialFields={{ type: "note", body: "test" }}
        />,
      );
      fireEvent.click(screen.getByTestId("annotation-edit-raw-btn"));
      expect(onEditRaw).toHaveBeenCalledWith({
        mode: "edit",
        draftDsl: "<!--- n | test --->",
        originalRange,
      });
    });

    it("Edit Raw not rendered when onEditRaw is not provided", () => {
      render(
        <AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />,
      );
      expect(screen.queryByTestId("annotation-edit-raw-btn")).not.toBeInTheDocument();
    });
  });

  describe("selection auto-fill", () => {
    it("selectedText sets scope to anchor and fills anchor text", () => {
      render(
        <AnnotationBuilderModal
          onClose={onClose}
          onInsert={onInsert}
          selectedText="hello world"
        />,
      );
      expect(screen.getByTestId("annotation-scope-select")).toHaveValue("anchor");
      expect(screen.getByTestId("annotation-anchor-input")).toHaveValue("hello world");
    });

    it("selectedText does not override explicit scope in initialFields", () => {
      render(
        <AnnotationBuilderModal
          onClose={onClose}
          onInsert={onInsert}
          selectedText="hello world"
          initialFields={{ scope: { kind: "paragraph", value: 1 } }}
        />,
      );
      expect(screen.getByTestId("annotation-scope-select")).toHaveValue("paragraph");
    });
  });

  describe("smart defaults", () => {
    it("defaults to Note type in create mode", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      expect(screen.getByTestId("annotation-type-select")).toHaveValue("note");
    });

    it("pre-fills ID with UUID in create mode", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      const idInput = screen.getByTestId("annotation-id-input") as HTMLInputElement;
      expect(idInput.value).toMatch(UUID_RE);
    });

    it("does not pre-fill ID in edit mode when no initialFields.id", () => {
      render(
        <AnnotationBuilderModal onClose={onClose} onInsert={onInsert} mode="edit" />,
      );
      expect(screen.getByTestId("annotation-id-input")).toHaveValue("");
    });

    it("pre-fills date with today in create mode", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      expect(screen.getByTestId("annotation-date-input")).toHaveValue("2026-06-01");
    });

    it("does not pre-fill date in edit mode", () => {
      render(
        <AnnotationBuilderModal onClose={onClose} onInsert={onInsert} mode="edit" />,
      );
      expect(screen.getByTestId("annotation-date-input")).toHaveValue("");
    });
  });

  describe("type dropdown options", () => {
    it("includes LLM option", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      const typeSelect = screen.getByTestId("annotation-type-select");
      const options = Array.from(typeSelect.querySelectorAll("option"));
      const llmOption = options.find((o) => o.value === "llm");
      expect(llmOption).toBeDefined();
      expect(llmOption!.textContent).toContain("LLM");
    });
  });

  describe("scope dropdown options", () => {
    it("includes Document option", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      const scopeSelect = screen.getByTestId("annotation-scope-select");
      const options = Array.from(scopeSelect.querySelectorAll("option"));
      expect(options.find((o) => o.value === "document")).toBeDefined();
    });

    it("includes Section option", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      const scopeSelect = screen.getByTestId("annotation-scope-select");
      const options = Array.from(scopeSelect.querySelectorAll("option"));
      expect(options.find((o) => o.value === "section")).toBeDefined();
    });

    it("document scope does not show count input", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "document" } });
      expect(screen.queryByTestId("annotation-scope-count")).not.toBeInTheDocument();
    });

    it("section scope does not show count input", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "section" } });
      expect(screen.queryByTestId("annotation-scope-count")).not.toBeInTheDocument();
    });

    it("document scope generates \\d in preview", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.change(screen.getByTestId("annotation-type-select"), { target: { value: "note" } });
      fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "document" } });
      const preview = screen.getByTestId("annotation-preview");
      expect(preview.textContent).toContain("\\d");
    });

    it("section scope generates \\h in preview", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.change(screen.getByTestId("annotation-type-select"), { target: { value: "note" } });
      fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "section" } });
      const preview = screen.getByTestId("annotation-preview");
      expect(preview.textContent).toContain("\\h");
    });
  });

  describe("rendered markdown preview", () => {
    it("renders body as markdown in preview", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.change(screen.getByTestId("annotation-body-input"), { target: { value: "**bold**" } });
      const rendered = screen.getByTestId("annotation-preview-rendered");
      expect(rendered.innerHTML).toContain("<strong>bold</strong>");
    });

    it("does not show rendered preview when body is empty", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      expect(screen.queryByTestId("annotation-preview-rendered")).not.toBeInTheDocument();
    });
  });

  describe("[id] support", () => {
    it("ID input renders and is pre-filled with UUID by default", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      const idInput = screen.getByTestId("annotation-id-input") as HTMLInputElement;
      expect(idInput).toBeInTheDocument();
      expect(idInput.value).toMatch(UUID_RE);
    });

    it("ID input updates preview with [id]", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.change(screen.getByTestId("annotation-body-input"), { target: { value: "hello" } });
      fireEvent.change(screen.getByTestId("annotation-id-input"), { target: { value: "my-note" } });
      const preview = screen.getByTestId("annotation-preview");
      expect(preview.textContent).toBe("<!---[my-note] n | hello @2026-06-01 --->");
    });

    it("insert with [id] produces correct DSL", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.change(screen.getByTestId("annotation-body-input"), { target: { value: "test" } });
      fireEvent.change(screen.getByTestId("annotation-id-input"), { target: { value: "ref-1" } });
      fireEvent.click(screen.getByTestId("annotation-insert-btn"));
      expect(onInsert).toHaveBeenCalledWith("<!---[ref-1] n | test @2026-06-01 --->");
    });

    it("initialFields with id pre-fills ID input", () => {
      render(
        <AnnotationBuilderModal
          onClose={onClose}
          onInsert={onInsert}
          initialFields={{ id: "pre-filled-id", type: "note", body: "x" }}
        />,
      );
      expect(screen.getByTestId("annotation-id-input")).toHaveValue("pre-filled-id");
      expect(screen.getByTestId("annotation-preview").textContent).toBe("<!---[pre-filled-id] n | x @2026-06-01 --->");
    });
  });

  describe("asymmetric scope split toggle", () => {
    it("split toggle appears when scope is sentence", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "sentence" } });
      expect(screen.getByTestId("annotation-asymmetric-toggle")).toBeInTheDocument();
    });

    it("split toggle does NOT appear when scope is none", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "none" } });
      expect(screen.queryByTestId("annotation-asymmetric-toggle")).not.toBeInTheDocument();
    });

    it("split toggle does NOT appear when scope is anchor", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "anchor" } });
      expect(screen.queryByTestId("annotation-asymmetric-toggle")).not.toBeInTheDocument();
    });

    it("split toggle does NOT appear when scope is document", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "document" } });
      expect(screen.queryByTestId("annotation-asymmetric-toggle")).not.toBeInTheDocument();
    });

    it("split toggle does NOT appear when scope is section", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "section" } });
      expect(screen.queryByTestId("annotation-asymmetric-toggle")).not.toBeInTheDocument();
    });

    it("enabling split toggle shows before/after inputs", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "sentence" } });
      fireEvent.click(screen.getByTestId("annotation-asymmetric-toggle"));
      expect(screen.getByTestId("annotation-scope-before")).toBeInTheDocument();
      expect(screen.getByTestId("annotation-scope-after")).toBeInTheDocument();
      expect(screen.queryByTestId("annotation-scope-count")).not.toBeInTheDocument();
    });

    it("asymmetric scope generates correct DSL", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.change(screen.getByTestId("annotation-type-select"), { target: { value: "note" } });
      fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "sentence" } });
      fireEvent.click(screen.getByTestId("annotation-asymmetric-toggle"));
      fireEvent.change(screen.getByTestId("annotation-scope-before"), { target: { value: "3" } });
      fireEvent.change(screen.getByTestId("annotation-scope-after"), { target: { value: "1" } });
      const preview = screen.getByTestId("annotation-preview");
      expect(preview.textContent).toMatch(/3\\s1/);
    });

    it("disabling split toggle reverts to symmetric, using the larger value", () => {
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "sentence" } });
      fireEvent.click(screen.getByTestId("annotation-asymmetric-toggle"));
      fireEvent.change(screen.getByTestId("annotation-scope-before"), { target: { value: "3" } });
      fireEvent.change(screen.getByTestId("annotation-scope-after"), { target: { value: "1" } });
      // Disable toggle
      fireEvent.click(screen.getByTestId("annotation-asymmetric-toggle"));
      expect(screen.getByTestId("annotation-scope-count")).toHaveValue(3);
    });

    it("editing existing asymmetric annotation pre-fills toggle and values", () => {
      render(
        <AnnotationBuilderModal
          onClose={onClose}
          onInsert={onInsert}
          mode="edit"
          initialFields={{
            scope: { kind: "asymmetric", value: { unit: "sentence", before: 2, after: 4 } },
          }}
        />,
      );
      const toggle = screen.getByTestId("annotation-asymmetric-toggle") as HTMLInputElement;
      expect(toggle.checked).toBe(true);
      expect(screen.getByTestId("annotation-scope-select")).toHaveValue("sentence");
      expect(screen.getByTestId("annotation-scope-before")).toHaveValue(2);
      expect(screen.getByTestId("annotation-scope-after")).toHaveValue(4);
    });

    it("editing document-scoped annotation and switching to sentence produces valid scope", () => {
      render(
        <AnnotationBuilderModal
          onClose={onClose}
          onInsert={onInsert}
          mode="edit"
          initialFields={{
            type: "note",
            scope: { kind: "document", value: 0 as const },
            body: "whole doc note",
          }}
        />,
      );
      fireEvent.change(screen.getByTestId("annotation-scope-select"), { target: { value: "sentence" } });
      const preview = screen.getByTestId("annotation-preview");
      expect(preview.textContent).toContain("\\s");
    });
  });

  describe("builder defaults prefill", () => {
    const SAVED_DEFAULTS: AnnotationBuilderDefaults = {
      type: "question",
      certainty: "firm",
      scopeKind: "paragraph",
      scopeCount: 3,
      asymmetric: false,
      scopeAfter: 1,
    };

    function enablePrefill(defaults: AnnotationBuilderDefaults = SAVED_DEFAULTS) {
      usePreferencesStore.setState({
        annotationPrefillLastUsed: true,
        annotationBuilderDefaults: defaults,
      });
    }

    function disablePrefill() {
      usePreferencesStore.setState({
        annotationPrefillLastUsed: false,
        annotationBuilderDefaults: SAVED_DEFAULTS,
      });
    }

    it("prefills from saved defaults when toggle is enabled (create mode)", () => {
      enablePrefill();
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      expect(screen.getByTestId("annotation-type-select")).toHaveValue("question");
      expect(screen.getByTestId("annotation-certainty-select")).toHaveValue("firm");
      expect(screen.getByTestId("annotation-scope-select")).toHaveValue("paragraph");
      expect(screen.getByTestId("annotation-scope-count")).toHaveValue(3);
    });

    it("does NOT prefill when toggle is disabled", () => {
      disablePrefill();
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      expect(screen.getByTestId("annotation-type-select")).toHaveValue("note");
      expect(screen.getByTestId("annotation-certainty-select")).toHaveValue("neutral");
      expect(screen.getByTestId("annotation-scope-select")).toHaveValue("none");
    });

    it("does NOT prefill in edit mode", () => {
      enablePrefill();
      render(
        <AnnotationBuilderModal onClose={onClose} onInsert={onInsert} mode="edit" />,
      );
      expect(screen.getByTestId("annotation-type-select")).toHaveValue("note");
      expect(screen.getByTestId("annotation-certainty-select")).toHaveValue("neutral");
    });

    it("initialFields overrides saved defaults", () => {
      enablePrefill();
      render(
        <AnnotationBuilderModal
          onClose={onClose}
          onInsert={onInsert}
          initialFields={{ type: "todo", certainty: "tentative" }}
        />,
      );
      expect(screen.getByTestId("annotation-type-select")).toHaveValue("todo");
      expect(screen.getByTestId("annotation-certainty-select")).toHaveValue("tentative");
      // scope still comes from defaults since initialFields didn't specify it
      expect(screen.getByTestId("annotation-scope-select")).toHaveValue("paragraph");
    });

    it("selectedText overrides saved scopeKind to anchor", () => {
      enablePrefill();
      render(
        <AnnotationBuilderModal
          onClose={onClose}
          onInsert={onInsert}
          selectedText="hello"
        />,
      );
      expect(screen.getByTestId("annotation-scope-select")).toHaveValue("anchor");
      // type/certainty still from defaults
      expect(screen.getByTestId("annotation-type-select")).toHaveValue("question");
      expect(screen.getByTestId("annotation-certainty-select")).toHaveValue("firm");
    });

    it("writes snapshot on insert", () => {
      let capturedArgs: Record<string, unknown> | undefined;
      mockInvoke((cmd, args) => {
        if (cmd === "set_preference") {
          capturedArgs = args;
          return undefined;
        }
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.change(screen.getByTestId("annotation-type-select"), { target: { value: "question" } });
      fireEvent.change(screen.getByTestId("annotation-certainty-select"), { target: { value: "firm" } });
      fireEvent.click(screen.getByTestId("annotation-insert-btn"));

      expect(onInsert).toHaveBeenCalled();
      expect(capturedArgs).toBeDefined();
      expect(capturedArgs!.key).toBe("annotations.builderDefaults");
      const snapshot = capturedArgs!.value as AnnotationBuilderDefaults;
      expect(snapshot.type).toBe("question");
      expect(snapshot.certainty).toBe("firm");
    });

    it("does NOT write snapshot on cancel", () => {
      let setCalled = false;
      mockInvoke((cmd) => {
        if (cmd === "set_preference") {
          setCalled = true;
          return undefined;
        }
        throw new Error(`Unknown command: ${cmd}`);
      });

      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      fireEvent.click(screen.getByTestId("annotation-cancel-btn"));

      expect(onClose).toHaveBeenCalled();
      expect(setCalled).toBe(false);
    });

    it("prefills asymmetric settings from saved defaults", () => {
      enablePrefill({
        type: "note",
        certainty: "neutral",
        scopeKind: "sentence",
        scopeCount: 2,
        asymmetric: true,
        scopeAfter: 4,
      });
      render(<AnnotationBuilderModal onClose={onClose} onInsert={onInsert} />);
      expect(screen.getByTestId("annotation-scope-select")).toHaveValue("sentence");
      const toggle = screen.getByTestId("annotation-asymmetric-toggle") as HTMLInputElement;
      expect(toggle.checked).toBe(true);
      expect(screen.getByTestId("annotation-scope-before")).toHaveValue(2);
      expect(screen.getByTestId("annotation-scope-after")).toHaveValue(4);
    });
  });
});

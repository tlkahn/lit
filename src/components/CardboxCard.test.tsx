import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CardboxCard } from "./CardboxCard";
import type { CardboxAnnotation } from "../lib/ipc";

const baseAnnotation: CardboxAnnotation = {
  uuid: "test-uuid",
  annotation_type: "note",
  certainty: "neutral",
  body: "This is a test annotation body that should be displayed in the card",
  date: "2026-06-15",
  source_page_id: "test.md",
  source_page_title: "Test Document",
  source_line: 5,
  char_start: 10,
  char_end: 50,
  scope_kind: "words",
  scope_value: "1",
  original: "The original source context text here",
};

describe("CardboxCard", () => {
  it("sets data-annotation-type on root card element", () => {
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, annotation_type: "question" }}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTestId("cardbox-card")).toHaveAttribute("data-annotation-type", "question");
  });

  it("renders collapsed state with badge, truncated body, and source", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTestId("card-type-badge")).toBeInTheDocument();
    expect(screen.getByTestId("card-body")).toBeInTheDocument();
    expect(screen.getByTestId("card-source")).toHaveTextContent("Test Document");
    // Navigate link should not be in the document in collapsed state (conditionally rendered)
    expect(screen.queryByTestId("card-navigate")).not.toBeInTheDocument();
  });

  it("renders expanded state with full body, original, date, and navigate link", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTestId("card-body")).toHaveTextContent(baseAnnotation.body!);
    expect(screen.getByTestId("card-original")).toHaveTextContent(baseAnnotation.original!);
    expect(screen.getByTestId("card-date")).toHaveTextContent("2026-06-15");
    expect(screen.getByTestId("card-navigate")).toBeVisible();
  });

  it("shows original quote in collapsed state", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTestId("card-original")).toBeInTheDocument();
  });

  it("applies line-clamp-2 to original in collapsed state", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTestId("card-original").className).toContain("line-clamp-2");
  });

  it("removes line-clamp from original when expanded", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTestId("card-original").className).not.toContain("line-clamp-2");
  });

  it("renders original as markdown HTML", () => {
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, original: "**bold** text" }}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const orig = screen.getByTestId("card-original");
    expect(orig.innerHTML).toContain("<strong>bold</strong>");
  });

  it("shows certainty mark for tentative", () => {
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, certainty: "tentative" }}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTestId("card-certainty")).toHaveTextContent("?");
  });

  it("shows certainty mark for firm", () => {
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, certainty: "firm" }}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTestId("card-certainty")).toHaveTextContent("!");
  });

  it("hides certainty mark for neutral", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.queryByTestId("card-certainty")).not.toBeInTheDocument();
  });

  it("calls onToggleExpand when clicked", () => {
    const onToggle = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={onToggle}
        onNavigate={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("cardbox-card"));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("calls onToggleExpand on Escape when expanded", () => {
    const onToggle = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={onToggle}
        onNavigate={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("cardbox-card"), { key: "Escape" });
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("does not call onToggleExpand on Escape when collapsed", () => {
    const onToggle = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={onToggle}
        onNavigate={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("cardbox-card"), { key: "Escape" });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("calls onNavigate when navigate link is clicked", () => {
    const onNavigate = vi.fn();
    const onToggle = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={onToggle}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByTestId("card-navigate"));
    expect(onNavigate).toHaveBeenCalledOnce();
    // Should not bubble to toggle
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("hides original context when annotation has no original", () => {
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, original: null }}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.queryByTestId("card-original")).not.toBeInTheDocument();
  });

  it("hides date when annotation has no date", () => {
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, date: null }}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.queryByTestId("card-date")).not.toBeInTheDocument();
  });

  it("renders markdown HTML in expanded body", () => {
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, body: "**bold** text" }}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const body = screen.getByTestId("card-body");
    expect(body.innerHTML).toContain("<strong>bold</strong>");
  });

  it("uses line-clamp in collapsed state instead of character truncation", () => {
    const longBody = "A".repeat(200);
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, body: longBody }}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const body = screen.getByTestId("card-body");
    expect(body.className).toContain("line-clamp-3");
  });

  it("does not apply line-clamp when expanded", () => {
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, body: "A".repeat(200) }}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const body = screen.getByTestId("card-body");
    expect(body.className).not.toContain("line-clamp-3");
  });

  it("does not toggle expand when clicking a markdown link", () => {
    const onToggle = vi.fn();
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, body: "[link](https://example.com)" }}
        expanded={true}
        onToggleExpand={onToggle}
        onNavigate={() => {}}
      />,
    );
    const link = screen.getByTestId("card-body").querySelector("a")!;
    fireEvent.click(link);
    expect(onToggle).not.toHaveBeenCalled();
  });

  // --- Card linking tests ---

  const linkedCards: CardboxAnnotation[] = [
    { ...baseAnnotation, uuid: "linked-1", annotation_type: "note", body: "First linked card body" },
    { ...baseAnnotation, uuid: "linked-2", annotation_type: "question", body: "Second linked card body" },
  ];

  it("shows link badge when links > 0", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        linkedCards={linkedCards}
      />,
    );
    const badge = screen.getByTestId("card-link-count");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("2");
  });

  it("hides link badge when no links", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        linkedCards={[]}
      />,
    );
    expect(screen.queryByTestId("card-link-count")).not.toBeInTheDocument();
  });

  it("shows linked card previews when expanded", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        linkedCards={linkedCards}
      />,
    );
    expect(screen.getByTestId("card-linked-section")).toBeInTheDocument();
    const previews = screen.getAllByTestId("linked-card-preview");
    expect(previews).toHaveLength(2);
  });

  it("hides linked section when collapsed", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        linkedCards={linkedCards}
      />,
    );
    // The linked section is conditionally rendered, not present when collapsed
    expect(screen.queryByTestId("card-linked-section")).not.toBeInTheDocument();
  });

  it("remove button calls onRemoveLink", () => {
    const onRemoveLink = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        linkedCards={linkedCards}
        onRemoveLink={onRemoveLink}
      />,
    );
    const removeButtons = screen.getAllByTestId("remove-link-button");
    fireEvent.click(removeButtons[0]!);
    expect(onRemoveLink).toHaveBeenCalledWith("linked-1");
  });

  it("clicking preview calls onFocusCard", () => {
    const onFocusCard = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        linkedCards={linkedCards}
        onFocusCard={onFocusCard}
      />,
    );
    const previews = screen.getAllByTestId("linked-card-preview");
    fireEvent.click(previews[0]!);
    expect(onFocusCard).toHaveBeenCalledWith("linked-1");
  });

  it("remove click does not toggle expand", () => {
    const onToggle = vi.fn();
    const onRemoveLink = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={onToggle}
        onNavigate={() => {}}
        linkedCards={linkedCards}
        onRemoveLink={onRemoveLink}
      />,
    );
    const removeButtons = screen.getAllByTestId("remove-link-button");
    fireEvent.click(removeButtons[0]!);
    expect(onRemoveLink).toHaveBeenCalledOnce();
    expect(onToggle).not.toHaveBeenCalled();
  });
});

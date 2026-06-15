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
  original: "The original source context text here",
};

describe("CardboxCard", () => {
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
    // Navigate link should not be visible in collapsed state (parent has opacity: 0)
    expect(screen.getByTestId("card-navigate")).not.toBeVisible();
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
        expanded={true}
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

  it("truncates long body in collapsed state", () => {
    const longBody = "A".repeat(200);
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, body: longBody }}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const bodyText = screen.getByTestId("card-body").textContent!;
    expect(bodyText.length).toBeLessThan(200);
    expect(bodyText).toContain("…");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CardboxCard, showCardFlipped } from "./CardboxCard";
import type { CardboxAnnotation } from "../lib/ipc";

interface FlipDeferred {
  resolve: () => void;
  reject: (err: unknown) => void;
}

/** Give the flip stage a controllable WAAPI stub so flips take the animated path. */
function installFakeAnimate(stage: HTMLElement) {
  const deferreds: FlipDeferred[] = [];
  const animate = vi.fn(() => {
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => {});
    deferreds.push({ resolve, reject });
    return { finished: promise } as unknown as Animation;
  });
  (stage as unknown as { animate: typeof animate }).animate = animate;
  return { animate, deferreds };
}

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

  it("renders collapsed state with badge and body without source on front", () => {
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
    const front = screen.getByTestId("card-face-front");
    expect(front.querySelector('[data-testid="card-source"]')).toBeNull();
    // Navigate lives in the always-visible action strip (#981).
    expect(screen.getByTestId("card-navigate")).toBeVisible();
  });

  it("renders expanded state with body, date, and navigate but no original or source on front", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTestId("card-body")).toHaveTextContent(baseAnnotation.body!);
    const front = screen.getByTestId("card-face-front");
    expect(front.querySelector('[data-testid="card-original"]')).toBeNull();
    expect(front.querySelector('[data-testid="card-source"]')).toBeNull();
    expect(screen.getByTestId("card-date")).toHaveTextContent("2026-06-15");
    expect(screen.getByTestId("card-navigate")).toBeVisible();
  });

  it("does not show original quote on front by default", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const front = screen.getByTestId("card-face-front");
    expect(front.querySelector('[data-testid="card-original"]')).toBeNull();
  });

  it("renders original as markdown HTML on back face", () => {
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, original: "**bold** text" }}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("card-flip"));
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

  it("does not call onToggleExpand when the card root is clicked", () => {
    // Whole-card click-to-expand is gone (#968): body clicks must leave text
    // selection alone; expansion goes through the chevron or keyboard.
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
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("clicking the back face does not toggle expand", () => {
    const onToggle = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={onToggle}
        onNavigate={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("card-flip"));
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("card-face-back"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("Escape collapses even when flipped", () => {
    const onToggle = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={onToggle}
        onNavigate={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("card-flip"));
    expect(screen.getByTestId("cardbox-card")).toHaveAttribute("data-flipped", "true");
    fireEvent.keyDown(screen.getByTestId("cardbox-card"), { key: "Escape" });
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

  it("calls onShowConnections when show-connections button is clicked", () => {
    const onShowConnections = vi.fn();
    const onToggle = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={onToggle}
        onNavigate={() => {}}
        onShowConnections={onShowConnections}
      />,
    );
    fireEvent.click(screen.getByTestId("card-show-connections"));
    expect(onShowConnections).toHaveBeenCalledOnce();
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

  it("marks expanded-content container inert when collapsed", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        onShowConnections={() => {}}
      />,
    );
    // Anchor via card-date: action buttons no longer live in expanded content (#981).
    const date = screen.getByTestId("card-date");
    const expandedContainer = date.closest(".overflow-hidden")!;
    expect(expandedContainer).toHaveAttribute("inert");
  });

  it("does not mark expanded-content container inert when expanded", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        onShowConnections={() => {}}
      />,
    );
    const date = screen.getByTestId("card-date");
    const expandedContainer = date.closest(".overflow-hidden")!;
    expect(expandedContainer).not.toHaveAttribute("inert");
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

  // --- Flip control tests ---

  it("shows flip button when annotation has original", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTestId("card-flip")).toBeInTheDocument();
  });

  it("hides flip button when annotation has no original", () => {
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, original: null }}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.queryByTestId("card-flip")).not.toBeInTheDocument();
  });

  it("root data-flipped is false by default", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTestId("cardbox-card")).toHaveAttribute("data-flipped", "false");
  });

  it("clicking flip toggles data-flipped and does not expand", () => {
    const onToggle = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={onToggle}
        onNavigate={() => {}}
      />,
    );
    const flip = screen.getByTestId("card-flip");
    fireEvent.click(flip);
    expect(screen.getByTestId("cardbox-card")).toHaveAttribute("data-flipped", "true");
    expect(onToggle).not.toHaveBeenCalled();
    expect(flip).toHaveAttribute("aria-label", "Show annotation");
    fireEvent.click(flip);
    expect(screen.getByTestId("cardbox-card")).toHaveAttribute("data-flipped", "false");
    expect(flip).toHaveAttribute("aria-label", "Show original quote");
  });

  it("flipped card shows original quote and source attribution", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("card-flip"));
    expect(screen.getByTestId("card-original")).toHaveTextContent(baseAnnotation.original!);
    expect(screen.getByTestId("card-source")).toHaveTextContent("Test Document");
  });

  it("mounts only the visible face: back when flipped, front otherwise", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTestId("card-face-front")).toBeInTheDocument();
    expect(screen.queryByTestId("card-face-back")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("card-flip"));
    expect(screen.queryByTestId("card-face-front")).not.toBeInTheDocument();
    expect(screen.getByTestId("card-face-back")).toBeInTheDocument();
  });

  it("expanded chrome lives on the front face and unmounts when flipped", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        note="a note"
        onSetNote={() => {}}
      />,
    );
    // Expanded-only chrome (date/linked/note) unmounts with the front face.
    // Strip action buttons persist across flip (#981).
    const front = screen.getByTestId("card-face-front");
    expect(front.querySelector('[data-testid="card-date"]')).toBeInTheDocument();
    expect(front.querySelector('[data-testid="card-note-display"]')).toBeInTheDocument();
    expect(screen.getByTestId("card-navigate")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("card-flip"));
    expect(screen.queryByTestId("card-date")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-note-display")).not.toBeInTheDocument();
    expect(screen.getByTestId("card-navigate")).toBeInTheDocument();
    expect(screen.getByTestId("card-face-back").querySelector('[data-testid="card-navigate"]')).toBeNull();
  });

  it("renders faces inside a flip stage, with no 3D scene/rotator wrappers", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const root = screen.getByTestId("cardbox-card");
    const stage = screen.getByTestId("card-flip-stage");
    expect(stage.contains(screen.getByTestId("card-face-front"))).toBe(true);
    expect(root.querySelector(".cardbox-card-scene")).toBeNull();
    expect(root.querySelector(".cardbox-card-rotator")).toBeNull();
    expect(root.querySelector(".cardbox-card-face")).toBeNull();
  });

  it("flipping back to front remounts the front face", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const flip = screen.getByTestId("card-flip");
    fireEvent.click(flip);
    fireEvent.click(flip);
    expect(screen.getByTestId("card-face-front")).toBeInTheDocument();
    expect(screen.queryByTestId("card-face-back")).not.toBeInTheDocument();
  });

  it("F key on focused card flips when original exists", () => {
    const onToggle = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={onToggle}
        onNavigate={() => {}}
      />,
    );
    const card = screen.getByTestId("cardbox-card");
    card.focus();
    fireEvent.keyDown(card, { key: "f" });
    expect(card).toHaveAttribute("data-flipped", "true");
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.keyDown(card, { key: "F" });
    expect(card).toHaveAttribute("data-flipped", "false");
  });

  it("F key does nothing when annotation has no original", () => {
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, original: null }}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const card = screen.getByTestId("cardbox-card");
    card.focus();
    fireEvent.keyDown(card, { key: "f" });
    expect(card).toHaveAttribute("data-flipped", "false");
  });

  it("F key ignored with modifier", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const card = screen.getByTestId("cardbox-card");
    card.focus();
    fireEvent.keyDown(card, { key: "f", metaKey: true });
    expect(card).toHaveAttribute("data-flipped", "false");
    fireEvent.keyDown(card, { key: "f", ctrlKey: true });
    expect(card).toHaveAttribute("data-flipped", "false");
    fireEvent.keyDown(card, { key: "f", altKey: true });
    expect(card).toHaveAttribute("data-flipped", "false");
  });

  it("flip button flips exactly once and root clicks never expand", () => {
    const onToggle = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={onToggle}
        onNavigate={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("card-flip"));
    expect(screen.getByTestId("cardbox-card")).toHaveAttribute("data-flipped", "true");
    fireEvent.click(screen.getByTestId("cardbox-card"));
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
    // The linked section is inside the grid-collapse area with opacity:0 / 0fr rows
    expect(screen.getByTestId("card-linked-section")).not.toBeVisible();
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

  // --- Slip note tests ---

  it("renders Add note trigger in the same action strip as navigate", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        onSetNote={() => {}}
      />,
    );
    const addButton = screen.getByTestId("card-note-add");
    expect(addButton).toBeInTheDocument();
    // Add note and navigate are both children of the action strip (#981).
    const strip = screen.getByTestId("card-action-strip");
    const navigate = screen.getByTestId("card-navigate");
    expect(strip.contains(addButton)).toBe(true);
    expect(strip.contains(navigate)).toBe(true);
    // The note editor body is not mounted yet (no note, not editing).
    expect(screen.queryByTestId("card-note-textarea")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-note-display")).not.toBeInTheDocument();
  });

  it("hides Add note button when onSetNote is not provided", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.queryByTestId("card-note-add")).not.toBeInTheDocument();
  });

  it("clicking Add note reveals the textarea below the row", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        onSetNote={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("card-note-add"));
    expect(screen.getByTestId("card-note-textarea")).toBeInTheDocument();
    // Trigger disappears once editing.
    expect(screen.queryByTestId("card-note-add")).not.toBeInTheDocument();
  });

  it("shows display state with Edit/Export for a card with an existing note", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        note="An existing slip note"
        onSetNote={() => {}}
        onExportNote={() => {}}
      />,
    );
    expect(screen.getByTestId("card-note-display")).toHaveTextContent("An existing slip note");
    expect(screen.getByTestId("card-note-edit")).toBeInTheDocument();
    expect(screen.getByTestId("card-note-export")).toBeInTheDocument();
    // No Add note trigger when a note already exists.
    expect(screen.queryByTestId("card-note-add")).not.toBeInTheDocument();
  });

  it("clicking card-note-display enters edit mode (click-to-edit)", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        note="Click me to edit"
        onSetNote={() => {}}
      />,
    );
    // Display state is showing
    expect(screen.getByTestId("card-note-display")).toBeInTheDocument();
    expect(screen.queryByTestId("card-note-textarea")).not.toBeInTheDocument();
    // Click the display element
    fireEvent.click(screen.getByTestId("card-note-display"));
    // Textarea appears (editing mode)
    expect(screen.getByTestId("card-note-textarea")).toBeInTheDocument();
    // Display element is gone
    expect(screen.queryByTestId("card-note-display")).not.toBeInTheDocument();
  });

  it("calls onExportNote when Export button is clicked", () => {
    const onExportNote = vi.fn();
    const onToggle = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={onToggle}
        onNavigate={() => {}}
        note="A note to export"
        onSetNote={() => {}}
        onExportNote={onExportNote}
      />,
    );
    fireEvent.click(screen.getByTestId("card-note-export"));
    expect(onExportNote).toHaveBeenCalledOnce();
    // Should not bubble to toggle
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("does not overwrite user draft when note prop changes mid-edit", () => {
    const onSetNote = vi.fn();
    const { rerender } = render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        note="original note"
        onSetNote={onSetNote}
      />,
    );
    // Enter edit mode
    fireEvent.click(screen.getByTestId("card-note-edit"));
    const textarea = screen.getByTestId("card-note-textarea");
    // User types a draft
    fireEvent.change(textarea, { target: { value: "user draft in progress" } });
    expect(textarea).toHaveValue("user draft in progress");

    // Simulate note prop changing while still editing (e.g. undo/redo, multi-window sync)
    rerender(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        note="externally changed note"
        onSetNote={onSetNote}
      />,
    );

    // Draft must survive -- should NOT be overwritten to "externally changed note"
    expect(screen.getByTestId("card-note-textarea")).toHaveValue("user draft in progress");
  });

  it("commits a new note via onSetNote on blur", () => {
    const onSetNote = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        onSetNote={onSetNote}
      />,
    );
    fireEvent.click(screen.getByTestId("card-note-add"));
    const textarea = screen.getByTestId("card-note-textarea");
    fireEvent.change(textarea, { target: { value: "hello note" } });
    fireEvent.blur(textarea);
    expect(onSetNote).toHaveBeenCalledWith("hello note");
  });

  it("edits an existing note via Edit button and commits on blur", () => {
    const onSetNote = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        note="existing text"
        onSetNote={onSetNote}
      />,
    );
    fireEvent.click(screen.getByTestId("card-note-edit"));
    const textarea = screen.getByTestId("card-note-textarea");
    expect(textarea).toHaveValue("existing text");
    fireEvent.change(textarea, { target: { value: "updated text" } });
    fireEvent.blur(textarea);
    expect(onSetNote).toHaveBeenCalledWith("updated text");
  });

  it("trims whitespace from note draft on commit", () => {
    const onSetNote = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        onSetNote={onSetNote}
      />,
    );
    fireEvent.click(screen.getByTestId("card-note-add"));
    const textarea = screen.getByTestId("card-note-textarea");
    fireEvent.change(textarea, { target: { value: "  hello  " } });
    fireEvent.blur(textarea);
    expect(onSetNote).toHaveBeenCalledWith("hello");
  });

  it("does not call onSetNote on blur when text is unchanged", () => {
    const onSetNote = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        note="existing text"
        onSetNote={onSetNote}
      />,
    );
    // Enter edit mode via Edit button
    fireEvent.click(screen.getByTestId("card-note-edit"));
    const textarea = screen.getByTestId("card-note-textarea");
    expect(textarea).toHaveValue("existing text");
    // Blur WITHOUT changing the text
    fireEvent.blur(textarea);
    // commitDraft guards: trimmed !== (note ?? ""), so onSetNote must NOT be called
    expect(onSetNote).not.toHaveBeenCalled();
  });

  it("pressing Escape cancels note editing without committing", () => {
    const onSetNote = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        onSetNote={onSetNote}
      />,
    );
    // Enter note editing mode by clicking "Add note"
    fireEvent.click(screen.getByTestId("card-note-add"));
    const textarea = screen.getByTestId("card-note-textarea");
    // Type something into the textarea
    fireEvent.change(textarea, { target: { value: "discard this" } });
    // Press Escape to cancel
    fireEvent.keyDown(textarea, { key: "Escape" });
    // onSetNote must NOT have been called — the draft is discarded
    expect(onSetNote).not.toHaveBeenCalled();
    // Textarea must be gone (noteEditing is now false, and there's no existing note)
    expect(screen.queryByTestId("card-note-textarea")).not.toBeInTheDocument();
    // "Add note" button reappears (noteEditing=false, note is undefined)
    expect(screen.getByTestId("card-note-add")).toBeInTheDocument();
  });

  // --- Content gutter tests ---

  it("uses in-flow flex layout instead of a pr-14 gutter (#981)", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        isPinned
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const root = screen.getByTestId("cardbox-card");
    expect(root.className).toMatch(/\bflex\b/);
    const stage = screen.getByTestId("card-flip-stage");
    expect(stage.className).toMatch(/flex-1/);
    expect(stage.className).toMatch(/min-w-0/);
    expect(screen.getByTestId("card-action-strip").className).toMatch(/shrink-0/);
    const front = screen.getByTestId("card-face-front");
    expect(front.className).not.toMatch(/pr-14/);
    fireEvent.click(screen.getByTestId("card-flip"));
    expect(screen.getByTestId("card-face-back").className).not.toMatch(/pr-14/);
  });

  // --- Back quote clamp tests ---

  it("applies line-clamp-2 to back quote when collapsed", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("card-flip"));
    expect(screen.getByTestId("card-original").className).toContain("line-clamp-2");
  });

  it("removes line-clamp from back quote when expanded", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("card-flip"));
    expect(screen.getByTestId("card-original").className).not.toContain("line-clamp-2");
  });

  // --- Source attribution tests ---

  it("clicking back-face source navigates and does not toggle expand", () => {
    const onNavigate = vi.fn();
    const onToggleExpand = vi.fn();
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={onToggleExpand}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByTestId("card-flip"));
    onToggleExpand.mockClear();
    fireEvent.click(screen.getByTestId("card-source"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it("clicking front-face source (no original) navigates and does not toggle expand", () => {
    const onNavigate = vi.fn();
    const onToggleExpand = vi.fn();
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, original: null }}
        expanded={false}
        onToggleExpand={onToggleExpand}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByTestId("card-source"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it("shows source on front when annotation has no original", () => {
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, original: null }}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const front = screen.getByTestId("card-face-front");
    expect(front.querySelector('[data-testid="card-source"]')).toHaveTextContent(
      "Test Document",
    );
  });

  // --- Source WCAG and empty-title tests ---

  it("source buttons use WCAG AA compliant text color classes", () => {
    const { rerender } = render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("card-flip"));
    const backSource = screen.getByTestId("card-source");
    expect(backSource.className).toContain("text-text-muted");
    expect(backSource.className).not.toContain("text-text-faint");

    rerender(
      <CardboxCard
        annotation={{ ...baseAnnotation, original: null }}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const frontSource = screen.getByTestId("card-source");
    expect(frontSource.className).toContain("text-text-muted");
    expect(frontSource.className).not.toContain("text-text-faint");
  });

  it("does not render back-face source button when title is empty", () => {
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, source_page_title: "" }}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("card-flip"));
    expect(screen.queryByTestId("card-source")).not.toBeInTheDocument();
  });

  // --- Back-face link guard tests ---

  it("does not toggle expand when clicking a markdown link on the back quote", () => {
    const onToggleExpand = vi.fn();
    render(
      <CardboxCard
        annotation={{ ...baseAnnotation, original: "see [x](https://example.com)" }}
        expanded={false}
        onToggleExpand={onToggleExpand}
        onNavigate={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("card-flip"));
    onToggleExpand.mockClear();
    const link = screen.getByTestId("card-original").querySelector("a");
    expect(link).toBeTruthy();
    fireEvent.click(link!);
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  // --- Flip state reset tests ---

  it("showCardFlipped is false when canFlip is false even if state is true", () => {
    expect(showCardFlipped(true, false)).toBe(false);
    expect(showCardFlipped(true, true)).toBe(true);
    expect(showCardFlipped(false, true)).toBe(false);
  });

  it("clears flip presentation when original becomes empty on the same instance", () => {
    const { rerender } = render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("card-flip"));
    expect(screen.getByTestId("cardbox-card")).toHaveAttribute("data-flipped", "true");

    rerender(
      <CardboxCard
        annotation={{ ...baseAnnotation, original: null }}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );

    const root = screen.getByTestId("cardbox-card");
    expect(root).toHaveAttribute("data-flipped", "false");
    expect(screen.getByTestId("card-face-front")).toBeInTheDocument();
    expect(screen.queryByTestId("card-face-back")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-flip")).not.toBeInTheDocument();
  });

  // --- Flip a11y tests ---

  it("flip button exposes pressed state", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const flip = screen.getByTestId("card-flip");
    expect(flip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(flip);
    expect(flip).toHaveAttribute("aria-pressed", "true");
  });

  // --- Enter/Space isolation tests ---

  it("Enter and Space on flip button do not bubble to card expand handlers", () => {
    const onToggleExpand = vi.fn();
    const onGridEnter = vi.fn();
    render(
      <div
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const t = e.target as HTMLElement;
            if (t.closest('[data-testid="cardbox-card"]')) onGridEnter();
          }
        }}
      >
        <CardboxCard
          annotation={baseAnnotation}
          expanded={false}
          onToggleExpand={onToggleExpand}
          onNavigate={() => {}}
        />
      </div>,
    );
    const flip = screen.getByTestId("card-flip");
    flip.focus();
    fireEvent.keyDown(flip, { key: "Enter" });
    expect(onGridEnter).not.toHaveBeenCalled();
    fireEvent.keyDown(flip, { key: " " });
    expect(onGridEnter).not.toHaveBeenCalled();
  });

  it("Enter and Space on strip action buttons do not bubble to card expand handlers", () => {
    const onGridEnter = vi.fn();
    render(
      <div
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            const t = e.target as HTMLElement;
            if (t.closest('[data-testid="cardbox-card"]')) onGridEnter();
          }
        }}
      >
        <CardboxCard
          annotation={baseAnnotation}
          expanded={false}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
        />
      </div>,
    );
    // card-navigate is representative of the new strip action buttons (#981).
    const navigate = screen.getByTestId("card-navigate");
    navigate.focus();
    fireEvent.keyDown(navigate, { key: "Enter" });
    expect(onGridEnter).not.toHaveBeenCalled();
    fireEvent.keyDown(navigate, { key: " " });
    expect(onGridEnter).not.toHaveBeenCalled();
  });

  // --- Focus handoff tests ---

  it("moves focus to the card root when F flips while focus is inside a face", async () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        note="x"
        onSetNote={() => {}}
      />,
    );
    const root = screen.getByTestId("cardbox-card");
    // card-navigate is in the strip (outside the stage); use an in-face control (#981).
    const noteEdit = screen.getByTestId("card-note-edit");
    noteEdit.focus();
    expect(document.activeElement).toBe(noteEdit);

    fireEvent.keyDown(noteEdit, { key: "f" });

    expect(root).toHaveAttribute("data-flipped", "true");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.activeElement).toBe(root);
    fireEvent.keyDown(root, { key: "f" });
    expect(root).toHaveAttribute("data-flipped", "false");
  });

  it("does not steal focus to the root when F flips while focus is on a strip button", async () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const root = screen.getByTestId("cardbox-card");
    const navigate = screen.getByTestId("card-navigate");
    navigate.focus();
    expect(document.activeElement).toBe(navigate);

    fireEvent.keyDown(navigate, { key: "f" });

    expect(root).toHaveAttribute("data-flipped", "true");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    // Strip is outside the stage, so focus stays on the strip button.
    expect(document.activeElement).toBe(navigate);
  });

  // --- Hidden face tests ---

  it("hidden face carries no aria-hidden/inert juggling — it is simply unmounted", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const front = screen.getByTestId("card-face-front");
    expect(front).not.toHaveAttribute("inert");
    expect(front).not.toHaveAttribute("aria-hidden");
    expect(screen.queryByTestId("card-face-back")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("card-flip"));

    expect(screen.queryByTestId("card-face-front")).not.toBeInTheDocument();
    const back = screen.getByTestId("card-face-back");
    expect(back).not.toHaveAttribute("inert");
    expect(back).not.toHaveAttribute("aria-hidden");
  });

  // --- Typing guard tests ---

  it("F in slip-note textarea does not flip the card", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        onSetNote={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("card-note-add"));
    const ta = screen.getByTestId("card-note-textarea");
    fireEvent.keyDown(ta, { key: "f" });
    expect(screen.getByTestId("cardbox-card")).toHaveAttribute("data-flipped", "false");
    fireEvent.keyDown(ta, { key: "F" });
    expect(screen.getByTestId("cardbox-card")).toHaveAttribute("data-flipped", "false");
  });

  // --- Glyph correctness tests ---

  it("Add note icon is fa-square_plus (U+F0FE), not a gear", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        onSetNote={() => {}}
      />,
    );
    // Icon-only strip button: glyph is the button's own text content (#981).
    expect(screen.getByTestId("card-note-add").textContent?.codePointAt(0)).toBe(0xf0fe);
  });

  it("flip icon is fa-rotate (U+F2F1)", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const flip = screen.getByTestId("card-flip");
    expect(flip.textContent?.codePointAt(0)).toBe(0xf2f1);
  });

  // --- WCAG AA color contrast tests ---

  it("action buttons use WCAG AA compliant text color classes", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        note="A note"
        onSetNote={() => {}}
        onExportNote={() => {}}
        onShowConnections={() => {}}
      />,
    );
    const interactiveButtons = [
      screen.getByTestId("card-navigate"),
      screen.getByTestId("card-show-connections"),
      screen.getByTestId("card-note-edit"),
      screen.getByTestId("card-note-export"),
    ];
    for (const btn of interactiveButtons) {
      expect(btn.className).toContain("text-text-muted");
      expect(btn.className).not.toContain("text-text-faint");
    }
  });

  // --- Animated flip tests (WAAPI available on the stage) ---

  it("animated flip swaps face content at the midpoint, not on click", async () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const { animate, deferreds } = installFakeAnimate(screen.getByTestId("card-flip-stage"));

    fireEvent.click(screen.getByTestId("card-flip"));

    // Out phase playing: content untouched, midpoint not reached yet.
    expect(animate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("card-face-front")).toBeInTheDocument();
    expect(screen.queryByTestId("card-face-back")).not.toBeInTheDocument();
    expect(screen.getByTestId("cardbox-card")).toHaveAttribute("data-flipped", "false");

    await act(async () => {
      deferreds[0]!.resolve();
    });

    // Midpoint: faces swapped, in phase started.
    expect(screen.queryByTestId("card-face-front")).not.toBeInTheDocument();
    expect(screen.getByTestId("card-face-back")).toBeInTheDocument();
    expect(screen.getByTestId("cardbox-card")).toHaveAttribute("data-flipped", "true");
    expect(animate).toHaveBeenCalledTimes(2);

    await act(async () => {
      deferreds[1]!.resolve();
    });
    expect(screen.getByTestId("cardbox-card")).toHaveAttribute("data-flipped", "true");
  });

  it("ignores flip clicks and F presses while a flip is in flight", async () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const { animate, deferreds } = installFakeAnimate(screen.getByTestId("card-flip-stage"));
    const card = screen.getByTestId("cardbox-card");
    const flip = screen.getByTestId("card-flip");

    fireEvent.click(flip);
    expect(animate).toHaveBeenCalledTimes(1);

    // Re-entry during the out phase is ignored.
    fireEvent.click(flip);
    fireEvent.keyDown(card, { key: "f" });
    expect(animate).toHaveBeenCalledTimes(1);
    expect(card).toHaveAttribute("data-flipped", "false");

    await act(async () => {
      deferreds[0]!.resolve();
    });

    // Re-entry during the in phase is also ignored.
    fireEvent.click(flip);
    fireEvent.keyDown(card, { key: "F" });
    expect(animate).toHaveBeenCalledTimes(2);
    expect(card).toHaveAttribute("data-flipped", "true");

    await act(async () => {
      deferreds[1]!.resolve();
    });

    // After completion a fresh flip starts a new two-phase animation.
    fireEvent.click(flip);
    expect(animate).toHaveBeenCalledTimes(3);
    await act(async () => {
      deferreds[2]!.resolve();
    });
    expect(card).toHaveAttribute("data-flipped", "false");
    expect(animate).toHaveBeenCalledTimes(4);
    await act(async () => {
      deferreds[3]!.resolve();
    });
  });

  it("animated flip refocuses the card root when focus was inside a face", async () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        note="x"
        onSetNote={() => {}}
      />,
    );
    const { deferreds } = installFakeAnimate(screen.getByTestId("card-flip-stage"));
    const root = screen.getByTestId("cardbox-card");
    // card-navigate is in the strip (outside the stage); use an in-face control (#981).
    const noteEdit = screen.getByTestId("card-note-edit");
    noteEdit.focus();
    expect(document.activeElement).toBe(noteEdit);

    fireEvent.keyDown(noteEdit, { key: "f" });
    await act(async () => {
      deferreds[0]!.resolve();
    });
    await act(async () => {
      deferreds[1]!.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(root).toHaveAttribute("data-flipped", "true");
    expect(document.activeElement).toBe(root);
  });

  it("unmounting mid-animation is safe (canceled out phase)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const { deferreds } = installFakeAnimate(screen.getByTestId("card-flip-stage"));
    fireEvent.click(screen.getByTestId("card-flip"));
    unmount();
    await act(async () => {
      deferreds[0]!.reject(new DOMException("aborted", "AbortError"));
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("unmounting mid-animation is safe (phases resolve after unmount)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const { animate, deferreds } = installFakeAnimate(screen.getByTestId("card-flip-stage"));
    fireEvent.click(screen.getByTestId("card-flip"));
    unmount();
    await act(async () => {
      deferreds[0]!.resolve();
    });
    await act(async () => {
      deferreds[1]?.resolve();
    });
    expect(animate.mock.calls.length).toBeLessThanOrEqual(2);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("Add note button uses WCAG AA compliant text color classes", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        onSetNote={() => {}}
      />,
    );
    const addBtn = screen.getByTestId("card-note-add");
    expect(addBtn.className).toContain("text-text-muted");
    expect(addBtn.className).not.toContain("text-text-faint");
  });

  it("add-note during in-flight flip lands on front face with editor open", async () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        onToggleExpand={() => {}}
        onNavigate={() => {}}
        onSetNote={() => {}}
      />,
    );
    const { deferreds } = installFakeAnimate(screen.getByTestId("card-flip-stage"));

    fireEvent.click(screen.getByTestId("card-flip"));
    // Out phase pending: click add-note before midpoint.
    fireEvent.click(screen.getByTestId("card-note-add"));

    await act(async () => {
      deferreds[0]!.resolve();
    });
    await act(async () => {
      deferreds[1]?.resolve();
    });

    expect(screen.getByTestId("cardbox-card")).toHaveAttribute("data-flipped", "false");
    expect(screen.getByTestId("card-note-textarea")).toBeInTheDocument();
  });

  describe("code rendering (#965)", () => {
    const indexCss = () =>
      readFileSync(resolve(__dirname, "../index.css"), "utf8");

    it("index.css neutralizes typography-plugin backtick pseudo-elements on prose code", () => {
      const css = indexCss();
      expect(css).toMatch(
        /\.prose code::before,\s*\.prose code::after\s*\{\s*content:\s*none;\s*\}/,
      );
    });

    it("index.css styles inline code as a chip on prose and the back face", () => {
      const css = indexCss();
      const chipRule = css.match(
        /\.prose code:not\(pre code\),\s*\[data-testid="card-original"\] code\s*\{[^}]*\}/,
      );
      expect(chipRule).not.toBeNull();
      expect(chipRule![0]).toContain("var(--code-background)");
      expect(chipRule![0]).toContain("var(--font-monospace-theme");
    });

    it("index.css clamps pre blocks to one line in collapsed cards", () => {
      const css = indexCss();
      const clampRule = css.match(
        /\[data-testid="cardbox-card"\] \.line-clamp-3 pre\s*\{[^}]*\}/,
      );
      expect(clampRule).not.toBeNull();
      expect(clampRule![0]).toContain("-webkit-line-clamp: 1");
      expect(clampRule![0]).toContain("overflow: hidden");
    });

    it("renders inline code in card body without literal backticks", () => {
      render(
        <CardboxCard
          annotation={{ ...baseAnnotation, body: "use `foo()` here" }}
          expanded={false}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
        />,
      );
      const body = screen.getByTestId("card-body");
      const code = body.querySelector("code");
      expect(code).not.toBeNull();
      expect(code!.textContent).toBe("foo()");
      expect(body.textContent).not.toContain("`");
    });

    it("renders inline code on the back face without literal backticks", () => {
      render(
        <CardboxCard
          annotation={{ ...baseAnnotation, original: "call `bar()` now" }}
          expanded={false}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
        />,
      );
      fireEvent.click(screen.getByTestId("card-flip"));
      const orig = screen.getByTestId("card-original");
      const code = orig.querySelector("code");
      expect(code).not.toBeNull();
      expect(code!.textContent).toBe("bar()");
      expect(orig.textContent).not.toContain("`");
    });
  });

  it("does not stop pointerdown propagation anywhere inside the card", () => {
    // Text selection starts with a pointerdown; any swallowed pointerdown
    // breaks drag-selection over that region (#968).
    const onContainerPointerDown = vi.fn();
    render(
      <div onPointerDown={onContainerPointerDown}>
        <CardboxCard
          annotation={baseAnnotation}
          expanded={true}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
          linkedCards={[{ ...baseAnnotation, uuid: "linked-1" }]}
          note="a note"
          onSetNote={() => {}}
        />
      </div>,
    );
    fireEvent.pointerDown(screen.getByTestId("card-flip"));
    expect(onContainerPointerDown).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(screen.getByTestId("card-navigate"));
    expect(onContainerPointerDown).toHaveBeenCalledTimes(2);
    fireEvent.pointerDown(screen.getByTestId("card-linked-section"));
    expect(onContainerPointerDown).toHaveBeenCalledTimes(3);
    fireEvent.pointerDown(screen.getByTestId("card-note-display"));
    expect(onContainerPointerDown).toHaveBeenCalledTimes(4);

    fireEvent.click(screen.getByTestId("card-note-edit"));
    fireEvent.pointerDown(screen.getByTestId("card-note-textarea"));
    expect(onContainerPointerDown).toHaveBeenCalledTimes(5);
  });

  describe("quote prefill (#968)", () => {
    const flushRaf = async () => {
      await act(async () => {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      });
    };

    it("opens the note editor with the quote appended and the caret at the end", async () => {
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={true}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
          onSetNote={() => {}}
          notePrefill={"> quoted"}
          onNotePrefillConsumed={() => {}}
        />,
      );
      const ta = screen.getByTestId("card-note-textarea") as HTMLTextAreaElement;
      expect(ta.value).toBe("> quoted\n\n");
      await flushRaf();
      expect(ta.selectionStart).toBe(ta.value.length);
      expect(ta.selectionEnd).toBe(ta.value.length);
    });

    it("separates an existing note from the quote with a blank line", async () => {
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={true}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
          note="old"
          onSetNote={() => {}}
          notePrefill={"> quoted"}
          onNotePrefillConsumed={() => {}}
        />,
      );
      const ta = screen.getByTestId("card-note-textarea") as HTMLTextAreaElement;
      expect(ta.value).toBe("old\n\n> quoted\n\n");
    });

    it("appends a second quote into an already-open editor", async () => {
      const props = {
        annotation: baseAnnotation,
        expanded: true,
        onToggleExpand: () => {},
        onNavigate: () => {},
        onSetNote: () => {},
      };
      const { rerender } = render(
        <CardboxCard {...props} notePrefill={"> one"} onNotePrefillConsumed={() => {}} />,
      );
      const ta = screen.getByTestId("card-note-textarea") as HTMLTextAreaElement;
      expect(ta.value).toBe("> one\n\n");
      rerender(
        <CardboxCard {...props} notePrefill={undefined} onNotePrefillConsumed={() => {}} />,
      );
      rerender(
        <CardboxCard {...props} notePrefill={"> two"} onNotePrefillConsumed={() => {}} />,
      );
      expect(ta.value).toBe("> one\n\n> two\n\n");
    });

    it("calls onNotePrefillConsumed exactly once per prefill", () => {
      const onConsumed = vi.fn();
      const { rerender } = render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={true}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
          onSetNote={() => {}}
          notePrefill={"> quoted"}
          onNotePrefillConsumed={onConsumed}
        />,
      );
      expect(onConsumed).toHaveBeenCalledTimes(1);
      // A re-render with the same staged prefill must not re-apply it.
      rerender(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={true}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
          onSetNote={() => {}}
          notePrefill={"> quoted"}
          onNotePrefillConsumed={onConsumed}
        />,
      );
      expect(onConsumed).toHaveBeenCalledTimes(1);
    });

    it("unflips a back-facing card so the prefilled editor is visible", () => {
      const props = {
        annotation: baseAnnotation,
        expanded: true,
        onToggleExpand: () => {},
        onNavigate: () => {},
        onSetNote: () => {},
        onNotePrefillConsumed: () => {},
      };
      const { rerender } = render(<CardboxCard {...props} />);
      fireEvent.click(screen.getByTestId("card-flip"));
      expect(screen.getByTestId("card-face-back")).toBeInTheDocument();

      rerender(<CardboxCard {...props} notePrefill={"> X\n"} />);
      expect(screen.getByTestId("card-face-front")).toBeInTheDocument();
      const ta = screen.getByTestId("card-note-textarea") as HTMLTextAreaElement;
      expect(ta.value).toContain("> X");
    });

    it("prefill during in-flight flip lands on front face with editor open", async () => {
      const props = {
        annotation: baseAnnotation,
        expanded: true,
        onToggleExpand: () => {},
        onNavigate: () => {},
        onSetNote: () => {},
        onNotePrefillConsumed: () => {},
      };
      const { rerender } = render(<CardboxCard {...props} />);
      const { deferreds } = installFakeAnimate(screen.getByTestId("card-flip-stage"));

      fireEvent.click(screen.getByTestId("card-flip"));
      // Out phase pending: stage a prefill before midpoint.
      rerender(<CardboxCard {...props} notePrefill="> quoted" />);

      await act(async () => {
        deferreds[0]!.resolve();
      });
      await act(async () => {
        deferreds[1]?.resolve();
      });

      expect(screen.getByTestId("cardbox-card")).toHaveAttribute("data-flipped", "false");
      expect(screen.getByTestId("card-note-textarea")).toBeInTheDocument();
    });

    it("does not expand the card itself (expansion is CardboxView's job)", () => {
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={false}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
          onSetNote={() => {}}
          notePrefill={"> quoted"}
          onNotePrefillConsumed={() => {}}
        />,
      );
      expect(screen.getByTestId("cardbox-card")).toHaveAttribute("data-expanded", "false");
    });
  });

  describe("text selection (#968)", () => {
    const indexCss = () =>
      readFileSync(resolve(__dirname, "../index.css"), "utf8");

    /** The `#root ... { user-select: auto }` opt-in selector list. */
    const optInSelectors = () => {
      const match = indexCss().match(
        /((?:#root [^{}]+,\s*)*#root [^{},]+)\s*\{\s*user-select:\s*auto;/,
      );
      expect(match).not.toBeNull();
      return match![1]!;
    };

    it("index.css opts the back-face quote into user-select auto", () => {
      expect(optInSelectors()).toContain('[data-testid="card-original"]');
    });

    it("index.css keeps .prose in the user-select auto list", () => {
      expect(optInSelectors()).toContain("#root .prose");
    });

    it("selectable text containers show a text cursor", () => {
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={false}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
        />,
      );
      expect(screen.getByTestId("card-body").className).toMatch(/cursor-text/);
      fireEvent.click(screen.getByTestId("card-flip"));
      expect(screen.getByTestId("card-original").className).toMatch(/cursor-text/);
    });

    it("chevron and flip buttons carry a padded 24px hit area", () => {
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={false}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
        />,
      );
      // 12px glyph + 2x6px padding = 24px WCAG 2.5.8 minimum target.
      expect(screen.getByTestId("card-flip").className).toMatch(/p-1\.5/);
      expect(screen.getByTestId("card-expand-toggle").className).toMatch(/p-1\.5/);
    });

    it("card root does not render a pointer cursor", () => {
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={false}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
        />,
      );
      expect(screen.getByTestId("cardbox-card").className).not.toContain("cursor-pointer");
    });
  });

  describe("action strip (#981)", () => {
    it("renders card-action-strip as a vertical toolbar", () => {
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={false}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
        />,
      );
      const strip = screen.getByTestId("card-action-strip");
      expect(strip).toHaveAttribute("role", "toolbar");
      expect(strip).toHaveAttribute("aria-orientation", "vertical");
      expect(strip.className).toMatch(/flex-col/);
    });

    it("absorbs pin, flip, and expand controls; old absolute corner is gone", () => {
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={false}
          isPinned
          onToggleExpand={() => {}}
          onNavigate={() => {}}
        />,
      );
      const strip = screen.getByTestId("card-action-strip");
      expect(strip.querySelector('[data-testid="pin-icon"]')).toBeInTheDocument();
      expect(strip.querySelector('[data-testid="card-flip"]')).toBeInTheDocument();
      expect(strip.querySelector('[data-testid="card-expand-toggle"]')).toBeInTheDocument();
      const root = screen.getByTestId("cardbox-card");
      expect(root.querySelector(".absolute")).toBeNull();
    });

    it("renders the strip when collapsed and when expanded", () => {
      const { unmount } = render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={false}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
        />,
      );
      expect(screen.getByTestId("card-action-strip")).toBeInTheDocument();
      unmount();

      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={true}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
        />,
      );
      expect(screen.getByTestId("card-action-strip")).toBeInTheDocument();
    });

    it("hosts navigate, connections, and add-note as icon-only strip children", () => {
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={false}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
          onShowConnections={() => {}}
          onSetNote={() => {}}
        />,
      );
      const strip = screen.getByTestId("card-action-strip");
      const navigate = screen.getByTestId("card-navigate");
      const connections = screen.getByTestId("card-show-connections");
      const addNote = screen.getByTestId("card-note-add");
      expect(strip.contains(navigate)).toBe(true);
      expect(strip.contains(connections)).toBe(true);
      expect(strip.contains(addNote)).toBe(true);

      expect(navigate).toHaveAttribute("aria-label", "Open in document");
      expect(navigate).toHaveAttribute("title", "Open in document");
      expect(connections).toHaveAttribute("aria-label", "Show connections");
      expect(connections).toHaveAttribute("title", "Show connections");
      expect(addNote).toHaveAttribute("aria-label", "Add note");
      expect(addNote).toHaveAttribute("title", "Add note");

      expect(navigate.textContent?.codePointAt(0)).toBe(0xf0219);
      expect(connections.textContent?.codePointAt(0)).toBe(0xf0339);
      expect(addNote.textContent?.codePointAt(0)).toBe(0xf0fe);

      // Icon-only: no visible text labels in the buttons.
      expect(navigate.textContent).not.toContain("Open in document");
      expect(connections.textContent).not.toContain("Show connections");
      expect(addNote.textContent).not.toContain("Add note");
    });

    it("makes navigate visible when the card is collapsed", () => {
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={false}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
        />,
      );
      expect(screen.getByTestId("card-navigate")).toBeVisible();
    });

    it("keeps action buttons out of the expanded-content container", () => {
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={true}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
          onShowConnections={() => {}}
          onSetNote={() => {}}
        />,
      );
      const date = screen.getByTestId("card-date");
      const expandedContainer = date.closest(".overflow-hidden")!;
      expect(expandedContainer.querySelector('[data-testid="card-navigate"]')).toBeNull();
      expect(expandedContainer.querySelector('[data-testid="card-show-connections"]')).toBeNull();
      expect(expandedContainer.querySelector('[data-testid="card-note-add"]')).toBeNull();
    });

    it("renders a separator between expand and navigate", () => {
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={false}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
        />,
      );
      const strip = screen.getByTestId("card-action-strip");
      const children = Array.from(strip.children);
      const expandIdx = children.findIndex(
        (el) => (el as HTMLElement).dataset.testid === "card-expand-toggle",
      );
      const sepIdx = children.findIndex(
        (el) => (el as HTMLElement).dataset.testid === "card-strip-separator",
      );
      const navIdx = children.findIndex(
        (el) => (el as HTMLElement).dataset.testid === "card-navigate",
      );
      expect(sepIdx).toBeGreaterThan(expandIdx);
      expect(navIdx).toBeGreaterThan(sepIdx);
    });

    it("auto-expands and opens the note editor when Add note is clicked while collapsed", () => {
      const onToggle = vi.fn();
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={false}
          onToggleExpand={onToggle}
          onNavigate={() => {}}
          onSetNote={() => {}}
        />,
      );
      fireEvent.click(screen.getByTestId("card-note-add"));
      expect(onToggle).toHaveBeenCalledOnce();
      expect(screen.getByTestId("card-note-textarea")).toBeInTheDocument();
    });

    it("opens the note editor without toggling expand when already expanded", () => {
      const onToggle = vi.fn();
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={true}
          onToggleExpand={onToggle}
          onNavigate={() => {}}
          onSetNote={() => {}}
        />,
      );
      fireEvent.click(screen.getByTestId("card-note-add"));
      expect(screen.getByTestId("card-note-textarea")).toBeInTheDocument();
      expect(onToggle).not.toHaveBeenCalled();
    });

    it("unflips a flipped card when Add note is clicked", () => {
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={true}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
          onSetNote={() => {}}
        />,
      );
      fireEvent.click(screen.getByTestId("card-flip"));
      expect(screen.getByTestId("card-face-back")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("card-note-add"));
      expect(screen.getByTestId("card-face-front")).toBeInTheDocument();
      expect(screen.getByTestId("card-note-textarea")).toBeInTheDocument();
    });

    it("keeps the full strip visible on the back face", () => {
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={false}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
          onShowConnections={() => {}}
          onSetNote={() => {}}
        />,
      );
      fireEvent.click(screen.getByTestId("card-flip"));
      expect(screen.getByTestId("card-face-back")).toBeInTheDocument();
      expect(screen.getByTestId("card-flip")).toBeVisible();
      expect(screen.getByTestId("card-expand-toggle")).toBeVisible();
      expect(screen.getByTestId("card-navigate")).toBeVisible();
      expect(screen.getByTestId("card-show-connections")).toBeVisible();
      expect(screen.getByTestId("card-note-add")).toBeVisible();
    });
  });

  describe("expand toggle button (#968)", () => {
    it("renders a top-right expand toggle whose click calls onToggleExpand", () => {
      const onToggle = vi.fn();
      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={false}
          onToggleExpand={onToggle}
          onNavigate={() => {}}
        />,
      );
      const toggle = screen.getByTestId("card-expand-toggle");
      fireEvent.click(toggle);
      expect(onToggle).toHaveBeenCalledOnce();
    });

    it("Enter on the expand toggle does not also reach the grid keyboard handler", () => {
      const onToggle = vi.fn();
      const onGridEnter = vi.fn();
      render(
        <div
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const t = e.target as HTMLElement;
              if (t.closest('[data-testid="cardbox-card"]')) onGridEnter();
            }
          }}
        >
          <CardboxCard
            annotation={baseAnnotation}
            expanded={false}
            onToggleExpand={onToggle}
            onNavigate={() => {}}
          />
        </div>,
      );
      const toggle = screen.getByTestId("card-expand-toggle");
      toggle.focus();
      fireEvent.keyDown(toggle, { key: "Enter" });
      expect(onGridEnter).not.toHaveBeenCalled();
      fireEvent.keyDown(toggle, { key: " " });
      expect(onGridEnter).not.toHaveBeenCalled();
    });

    it("flips aria-expanded and label with the expanded prop", () => {
      const { unmount } = render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={false}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
        />,
      );
      let toggle = screen.getByTestId("card-expand-toggle");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveAttribute("aria-label", "Expand card");
      unmount();

      render(
        <CardboxCard
          annotation={baseAnnotation}
          expanded={true}
          onToggleExpand={() => {}}
          onNavigate={() => {}}
        />,
      );
      toggle = screen.getByTestId("card-expand-toggle");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle).toHaveAttribute("aria-label", "Collapse card");
    });
  });
});

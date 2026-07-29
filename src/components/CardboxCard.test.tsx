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
    // Navigate link should not be visible in collapsed state (parent has opacity: 0)
    expect(screen.getByTestId("card-navigate")).not.toBeVisible();
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

  it("clicking back face toggles expand", () => {
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
    expect(onToggle).toHaveBeenCalledOnce();
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
    const navigateBtn = screen.getByTestId("card-navigate");
    const expandedContainer = navigateBtn.closest(".overflow-hidden")!;
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
    const navigateBtn = screen.getByTestId("card-navigate");
    const expandedContainer = navigateBtn.closest(".overflow-hidden")!;
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
      />,
    );
    const front = screen.getByTestId("card-face-front");
    expect(front.querySelector('[data-testid="card-navigate"]')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("card-flip"));
    expect(screen.queryByTestId("card-navigate")).not.toBeInTheDocument();
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

  it("flip button sits outside expand hit-path when card clicked elsewhere still expands", () => {
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

  it("renders Add note trigger in the same action row as navigate", () => {
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
    // Add note trigger and navigate button share the same flex row parent.
    const navigate = screen.getByTestId("card-navigate");
    expect(addButton.parentElement).toBe(navigate.parentElement);
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

  it("reserves right gutter so body does not sit under pin/flip chrome", () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={false}
        isPinned
        onToggleExpand={() => {}}
        onNavigate={() => {}}
      />,
    );
    const front = screen.getByTestId("card-face-front");
    expect(front.className).toMatch(/pr-8/);
    fireEvent.click(screen.getByTestId("card-flip"));
    expect(screen.getByTestId("card-face-back").className).toMatch(/pr-8/);
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

  // --- Focus handoff tests ---

  it("moves focus to the card root when F flips while focus is inside a face", async () => {
    render(
      <CardboxCard
        annotation={baseAnnotation}
        expanded={true}
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
    expect(document.activeElement).toBe(root);
    fireEvent.keyDown(root, { key: "f" });
    expect(root).toHaveAttribute("data-flipped", "false");
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
    const icon = screen.getByTestId("card-note-add").querySelector(".nerd-font");
    expect(icon?.textContent?.codePointAt(0)).toBe(0xf0fe);
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
      />,
    );
    const { deferreds } = installFakeAnimate(screen.getByTestId("card-flip-stage"));
    const root = screen.getByTestId("cardbox-card");
    const navigate = screen.getByTestId("card-navigate");
    navigate.focus();
    expect(document.activeElement).toBe(navigate);

    fireEvent.keyDown(navigate, { key: "f" });
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
});

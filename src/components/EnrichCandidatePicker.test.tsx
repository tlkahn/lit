import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { EnrichCandidatePicker } from "./EnrichCandidatePicker";
import type { BibEntry } from "../lib/ipc";

const candidateA: BibEntry = {
  key: "smith2020",
  authors: ["Smith, John", "Doe, Jane"],
  title: "A Great Paper",
  year: "2020",
  entry_type: "article",
  line_number: 0,
  journal: "Nature",
  doi: "10.1000/xyz",
  abstract_text: "This paper investigates important things about the world.",
};

const candidateB: BibEntry = {
  key: "smith2020alt",
  authors: ["Smith, J."],
  title: "A Great Paper (preprint)",
  year: "2020",
  entry_type: "book",
  line_number: 0,
};

const defaultProps = {
  open: true,
  bibKey: "smith2020",
  candidates: [candidateA, candidateB],
  providersSearched: ["CrossRef", "S2"],
  providersFailed: ["OpenAlex"],
  onApply: vi.fn(),
  onClose: vi.fn(),
};

beforeEach(() => {
  defaultProps.onApply = vi.fn();
  defaultProps.onClose = vi.fn();
});

describe("EnrichCandidatePicker", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} open={false} />,
    );
    expect(container.querySelector("[data-testid='enrich-picker-dialog']")).toBeNull();
  });

  it("renders dialog when open", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    expect(container.querySelector("[data-testid='enrich-picker-dialog']")).toBeTruthy();
  });

  it("header includes the bibKey", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    const dialog = container.querySelector("[data-testid='enrich-picker-dialog']")!;
    expect(dialog.textContent).toContain("smith2020");
  });

  it("Escape closes dialog", () => {
    render(<EnrichCandidatePicker {...defaultProps} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking backdrop closes dialog", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    const backdrop = container.querySelector("[data-testid='enrich-picker-backdrop']")!;
    fireEvent.click(backdrop);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking inside dialog does not close", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    const dialog = container.querySelector("[data-testid='enrich-picker-dialog']")!;
    fireEvent.click(dialog);
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it("Cancel button calls onClose", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    const cancelBtn = container.querySelector("[data-testid='enrich-picker-cancel-btn']") as HTMLButtonElement;
    expect(cancelBtn).toBeTruthy();
    fireEvent.click(cancelBtn);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("Close X button calls onClose", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    const closeBtn = container.querySelector("[data-testid='enrich-picker-close']") as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("renders provider status badges", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    const dialog = container.querySelector("[data-testid='enrich-picker-dialog']")!;
    // Check searched providers have accent styling
    expect(dialog.textContent).toContain("CrossRef");
    expect(dialog.textContent).toContain("S2");
    expect(dialog.textContent).toContain("OpenAlex");

    // Check badge CSS classes -- filter by content to avoid matching EntryTypeBadge
    const badges = dialog.querySelectorAll("span");
    const accentBadges = Array.from(badges).filter(
      (b) =>
        b.className.includes("text-interactive-accent") &&
        !b.className.includes("text-text-error") &&
        b.textContent?.includes("✓"),
    );
    const errorBadges = Array.from(badges).filter(
      (b) =>
        b.className.includes("text-text-error") &&
        b.textContent?.includes("✗"),
    );
    expect(accentBadges.length).toBe(2); // CrossRef, S2
    expect(errorBadges.length).toBe(1); // OpenAlex
  });

  it("renders candidate count", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    const dialog = container.querySelector("[data-testid='enrich-picker-dialog']")!;
    expect(dialog.textContent).toContain("2 candidates");
  });

  it("singular count for one candidate", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} candidates={[candidateA]} />,
    );
    const dialog = container.querySelector("[data-testid='enrich-picker-dialog']")!;
    expect(dialog.textContent).toContain("1 candidate");
    expect(dialog.textContent).not.toContain("1 candidates");
  });

  it("renders candidate cards with metadata", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    const cards = container.querySelectorAll("[data-testid='enrich-candidate-card']");
    expect(cards.length).toBe(2);

    // First card: candidateA
    const cardA = cards[0]!;
    expect(cardA.textContent).toContain("A Great Paper");
    expect(cardA.textContent).toContain("Smith, John");
    expect(cardA.textContent).toContain("Doe, Jane");
    expect(cardA.textContent).toContain("2020");
    expect(cardA.textContent).toContain("Nature");
    expect(cardA.textContent).toContain("10.1000/xyz");
    expect(cardA.textContent).toContain("This paper investigates important things");

    // Second card: candidateB
    const cardB = cards[1]!;
    expect(cardB.textContent).toContain("A Great Paper (preprint)");
    expect(cardB.textContent).toContain("Smith, J.");
  });

  it("renders EntryTypeBadge for non-hidden entry types", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    // candidateA is "article" which is in HIDDEN_ENTRY_TYPES -- no badge
    // candidateB is "book" -- should render an EntryTypeBadge
    const badges = container.querySelectorAll("[data-testid='entry-type-badge']");
    expect(badges.length).toBe(1);
    expect(badges[0]!.textContent).toBe("book");
  });

  it("Apply button calls onApply with correct candidate", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    const applyBtns = container.querySelectorAll("[data-testid='enrich-apply-btn']");
    expect(applyBtns.length).toBe(2);

    fireEvent.click(applyBtns[0]!);
    expect(defaultProps.onApply).toHaveBeenCalledTimes(1);
    expect(defaultProps.onApply).toHaveBeenCalledWith(candidateA);
  });

  it("clicking second Apply button calls onApply with the second candidate", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    const applyBtns = container.querySelectorAll("[data-testid='enrich-apply-btn']");
    fireEvent.click(applyBtns[1]!);
    expect(defaultProps.onApply).toHaveBeenCalledWith(candidateB);
  });

  // --- Keyboard navigation (Phase 3.3) ---

  it("first candidate is selected by default", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    const cards = container.querySelectorAll("[data-testid='enrich-candidate-card']");
    expect(cards[0]!.className).toContain("border-interactive-accent");
    expect(cards[1]!.className).not.toContain("border-interactive-accent");
  });

  it("ArrowDown moves selection to next candidate", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    fireEvent.keyDown(document, { key: "ArrowDown" });
    const cards = container.querySelectorAll("[data-testid='enrich-candidate-card']");
    expect(cards[0]!.className).not.toContain("border-interactive-accent");
    expect(cards[1]!.className).toContain("border-interactive-accent");
  });

  it("ArrowUp moves selection to previous candidate", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    // Move down first, then up
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowUp" });
    const cards = container.querySelectorAll("[data-testid='enrich-candidate-card']");
    expect(cards[0]!.className).toContain("border-interactive-accent");
  });

  it("ArrowUp at first candidate stays at first", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    fireEvent.keyDown(document, { key: "ArrowUp" });
    const cards = container.querySelectorAll("[data-testid='enrich-candidate-card']");
    expect(cards[0]!.className).toContain("border-interactive-accent");
  });

  it("ArrowDown at last candidate stays at last", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowDown" }); // past end
    const cards = container.querySelectorAll("[data-testid='enrich-candidate-card']");
    expect(cards[1]!.className).toContain("border-interactive-accent");
  });

  it("Enter applies the selected candidate", () => {
    render(<EnrichCandidatePicker {...defaultProps} />);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(defaultProps.onApply).toHaveBeenCalledTimes(1);
    expect(defaultProps.onApply).toHaveBeenCalledWith(candidateB);
  });

  it("Enter applies first candidate when no arrows pressed", () => {
    render(<EnrichCandidatePicker {...defaultProps} />);
    fireEvent.keyDown(document, { key: "Enter" });
    expect(defaultProps.onApply).toHaveBeenCalledWith(candidateA);
  });

  it("selectedIndex resets to 0 when picker re-opens", () => {
    const { rerender, container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    fireEvent.keyDown(document, { key: "ArrowDown" });
    // Close then reopen
    rerender(<EnrichCandidatePicker {...defaultProps} open={false} />);
    rerender(<EnrichCandidatePicker {...defaultProps} open={true} />);
    const cards = container.querySelectorAll("[data-testid='enrich-candidate-card']");
    expect(cards[0]!.className).toContain("border-interactive-accent");
  });

  // --- Accessibility (Phase 3.3) ---

  it("candidate list has listbox role and aria attributes", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    const list = container.querySelector("[data-testid='enrich-picker-list']")!;
    expect(list.getAttribute("role")).toBe("listbox");
    expect(list.getAttribute("aria-label")).toBe("Enrichment candidates for smith2020");
    expect(list.getAttribute("aria-activedescendant")).toBe("enrich-candidate-0");
  });

  it("candidate cards have option role and aria-selected", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    const cards = container.querySelectorAll("[data-testid='enrich-candidate-card']");
    expect(cards[0]!.getAttribute("role")).toBe("option");
    expect(cards[0]!.getAttribute("aria-selected")).toBe("true");
    expect(cards[1]!.getAttribute("role")).toBe("option");
    expect(cards[1]!.getAttribute("aria-selected")).toBe("false");
  });

  it("aria-activedescendant updates on ArrowDown", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    fireEvent.keyDown(document, { key: "ArrowDown" });
    const list = container.querySelector("[data-testid='enrich-picker-list']")!;
    expect(list.getAttribute("aria-activedescendant")).toBe("enrich-candidate-1");
  });

  it("dialog has role=dialog and aria-modal", () => {
    const { container } = render(
      <EnrichCandidatePicker {...defaultProps} />,
    );
    const dialog = container.querySelector("[data-testid='enrich-picker-dialog']")!;
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Select matching entry for smith2020");
  });
});

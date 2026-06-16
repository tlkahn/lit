import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EntryTypeBadge, HIDDEN_ENTRY_TYPES } from "./EntryTypeBadge";

describe("EntryTypeBadge", () => {
  it("renders badge for visible entry types", () => {
    render(<EntryTypeBadge entryType="book" />);
    const badge = screen.getByTestId("entry-type-badge");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe("book");
  });

  it("returns null for 'article' type", () => {
    const { container } = render(<EntryTypeBadge entryType="article" />);
    expect(container.innerHTML).toBe("");
  });

  it("returns null for 'misc' type", () => {
    const { container } = render(<EntryTypeBadge entryType="misc" />);
    expect(container.innerHTML).toBe("");
  });

  it("returns null for empty string type", () => {
    const { container } = render(<EntryTypeBadge entryType="" />);
    expect(container.innerHTML).toBe("");
  });

  it("appends extra className when provided", () => {
    render(<EntryTypeBadge entryType="book" className="shrink-0" />);
    const badge = screen.getByTestId("entry-type-badge");
    expect(badge.className).toContain("shrink-0");
    // Still has base classes
    expect(badge.className).toContain("rounded");
  });

  it("uses accent color for book types", () => {
    for (const t of ["book", "inbook", "incollection"]) {
      const { unmount } = render(<EntryTypeBadge entryType={t} />);
      const badge = screen.getByTestId("entry-type-badge");
      expect(badge.className).toContain("bg-interactive-accent/15");
      expect(badge.className).toContain("text-interactive-accent");
      expect(badge.className).not.toContain("bg-bg-hover");
      unmount();
    }
  });

  it("uses purple color for conference types", () => {
    for (const t of ["inproceedings", "proceedings", "conference"]) {
      const { unmount } = render(<EntryTypeBadge entryType={t} />);
      const badge = screen.getByTestId("entry-type-badge");
      expect(badge.style.color).toBe("var(--color-purple)");
      expect(badge.style.backgroundColor).toContain("color-mix");
      expect(badge.className).not.toContain("bg-bg-hover");
      unmount();
    }
  });

  it("uses orange color for thesis types", () => {
    for (const t of ["phdthesis", "mastersthesis"]) {
      const { unmount } = render(<EntryTypeBadge entryType={t} />);
      const badge = screen.getByTestId("entry-type-badge");
      expect(badge.style.color).toBe("var(--color-orange)");
      expect(badge.style.backgroundColor).toContain("color-mix");
      expect(badge.className).not.toContain("bg-bg-hover");
      unmount();
    }
  });

  it("uses default muted style for other visible types", () => {
    render(<EntryTypeBadge entryType="techreport" />);
    const badge = screen.getByTestId("entry-type-badge");
    expect(badge.className).toContain("bg-bg-hover");
    expect(badge.className).toContain("text-text-muted");
  });

  it("does not append extra space when className is not provided", () => {
    render(<EntryTypeBadge entryType="book" />);
    const badge = screen.getByTestId("entry-type-badge");
    expect(badge.className).not.toMatch(/\s$/);
  });

  it("does not produce trailing space when colorClass is empty", () => {
    render(<EntryTypeBadge entryType="conference" />);
    const badge = screen.getByTestId("entry-type-badge");
    expect(badge.className).not.toMatch(/\s$/);
  });
});

describe("HIDDEN_ENTRY_TYPES", () => {
  it("contains article, misc, and empty string", () => {
    expect(HIDDEN_ENTRY_TYPES.has("article")).toBe(true);
    expect(HIDDEN_ENTRY_TYPES.has("misc")).toBe(true);
    expect(HIDDEN_ENTRY_TYPES.has("")).toBe(true);
  });

  it("does not contain book or inproceedings", () => {
    expect(HIDDEN_ENTRY_TYPES.has("book")).toBe(false);
    expect(HIDDEN_ENTRY_TYPES.has("inproceedings")).toBe(false);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaperSearchResults } from "./PaperSearchResults";
import type { BibEntry, PaperSearchResult } from "../lib/ipc";

function makeEntry(overrides: Partial<BibEntry> = {}): BibEntry {
  return {
    key: "smith2020",
    authors: ["Smith, Alice", "Jones, Bob"],
    title: "A Great Paper",
    year: "2020",
    entry_type: "article",
    line_number: 0,
    journal: "Nature",
    doi: "10.1234/test",
    ...overrides,
  };
}

function makeResults(
  entries: BibEntry[],
  overrides: Partial<PaperSearchResult> = {},
): PaperSearchResult {
  return {
    entries,
    pdf_urls: {},
    total_results: entries.length,
    providers_searched: ["crossref"],
    providers_failed: [],
    ...overrides,
  };
}

describe("PaperSearchResults", () => {
  const onSave = vi.fn();
  let savingKeys: Set<string>;
  let savedKeys: Set<string>;
  let duplicateKeys: Map<string, string>;

  beforeEach(() => {
    onSave.mockReset();
    savingKeys = new Set();
    savedKeys = new Set();
    duplicateKeys = new Map();
  });

  function renderResults(entries: BibEntry[], overrides: Partial<PaperSearchResult> = {}) {
    return render(
      <PaperSearchResults
        results={makeResults(entries, overrides)}
        onSave={onSave}
        savingKeys={savingKeys}
        savedKeys={savedKeys}
        duplicateKeys={duplicateKeys}
      />,
    );
  }

  describe("EntryTypeBadge", () => {
    it("shows entry type badge for 'book' type", () => {
      renderResults([makeEntry({ entry_type: "book" })]);
      const badge = screen.getByTestId("entry-type-badge");
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toBe("book");
    });

    it("shows entry type badge for 'inproceedings' type", () => {
      renderResults([makeEntry({ entry_type: "inproceedings" })]);
      const badge = screen.getByTestId("entry-type-badge");
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toBe("inproceedings");
    });

    it("does not show entry type badge for 'article' type", () => {
      renderResults([makeEntry({ entry_type: "article" })]);
      expect(screen.queryByTestId("entry-type-badge")).not.toBeInTheDocument();
    });

    it("does not show entry type badge for 'misc' type", () => {
      renderResults([makeEntry({ entry_type: "misc" })]);
      expect(screen.queryByTestId("entry-type-badge")).not.toBeInTheDocument();
    });

    it("does not show entry type badge for empty string type", () => {
      renderResults([makeEntry({ entry_type: "" })]);
      expect(screen.queryByTestId("entry-type-badge")).not.toBeInTheDocument();
    });
  });

  describe("Collapsed row - publisher display", () => {
    it("shows publisher in collapsed row when publisher differs from journal", () => {
      renderResults([
        makeEntry({ journal: "Nature", publisher: "Springer" }),
      ]);
      expect(screen.getByText(/Springer/)).toBeInTheDocument();
    });

    it("does not show publisher in collapsed row when publisher equals journal", () => {
      renderResults([
        makeEntry({ journal: "Nature", publisher: "Nature" }),
      ]);
      // "Nature" should appear once (journal), not duplicated
      const textContent = screen.getByTestId("search-results-list").textContent;
      const natureMatches = textContent!.match(/Nature/g) || [];
      // title area + journal = we don't want publisher duplicate
      expect(natureMatches.length).toBeLessThanOrEqual(1);
    });

    it("does not show publisher in collapsed row when publisher is absent", () => {
      renderResults([
        makeEntry({ publisher: undefined }),
      ]);
      // Just renders without error
      expect(screen.getByText("A Great Paper")).toBeInTheDocument();
    });
  });

  describe("Expanded view - publisher", () => {
    it("shows publisher in expanded view when publisher differs from journal", async () => {
      const user = userEvent.setup();
      renderResults([
        makeEntry({ journal: "Nature", publisher: "Springer" }),
      ]);
      await user.click(screen.getByText("A Great Paper"));

      const publisherEl = screen.getByTestId("entry-publisher");
      expect(publisherEl).toBeInTheDocument();
      expect(publisherEl.textContent).toBe("Springer");
    });

    it("does not show publisher in expanded view when publisher equals journal", async () => {
      const user = userEvent.setup();
      renderResults([
        makeEntry({ journal: "Nature", publisher: "Nature" }),
      ]);
      await user.click(screen.getByText("A Great Paper"));

      expect(screen.queryByTestId("entry-publisher")).not.toBeInTheDocument();
    });

    it("does not show publisher in expanded view when publisher is absent", async () => {
      const user = userEvent.setup();
      renderResults([makeEntry({ publisher: undefined })]);
      await user.click(screen.getByText("A Great Paper"));

      expect(screen.queryByTestId("entry-publisher")).not.toBeInTheDocument();
    });
  });

  describe("Expanded view - volume/issue/pages", () => {
    it("shows volume, number, and pages when all present", async () => {
      const user = userEvent.setup();
      renderResults([
        makeEntry({ volume: "30", number: "1", pages: "5998-6008" }),
      ]);
      await user.click(screen.getByText("A Great Paper"));

      expect(screen.getByText(/vol\. 30/)).toBeInTheDocument();
      expect(screen.getByText(/no\. 1/)).toBeInTheDocument();
      expect(screen.getByText(/pp\. 5998-6008/)).toBeInTheDocument();
    });

    it("shows only volume when number and pages are absent", async () => {
      const user = userEvent.setup();
      renderResults([
        makeEntry({ volume: "30", number: undefined, pages: undefined }),
      ]);
      await user.click(screen.getByText("A Great Paper"));

      expect(screen.getByText("vol. 30")).toBeInTheDocument();
    });

    it("does not show volume/issue/pages line when all are absent", async () => {
      const user = userEvent.setup();
      renderResults([
        makeEntry({ volume: undefined, number: undefined, pages: undefined }),
      ]);
      await user.click(screen.getByText("A Great Paper"));

      expect(screen.queryByText(/vol\./)).not.toBeInTheDocument();
      expect(screen.queryByText(/no\./)).not.toBeInTheDocument();
      expect(screen.queryByText(/pp\./)).not.toBeInTheDocument();
    });
  });

  describe("Expanded view - ISBN", () => {
    it("shows ISBN as Open Library link when isbn is present", async () => {
      const user = userEvent.setup();
      renderResults([
        makeEntry({ isbn: "978-0-123456-78-9", entry_type: "book" }),
      ]);
      await user.click(screen.getByText("A Great Paper"));

      const isbnEl = screen.getByTestId("entry-isbn");
      expect(isbnEl).toBeInTheDocument();
      const link = isbnEl.closest("a") ?? isbnEl.querySelector("a") ?? isbnEl;
      expect(link).toHaveAttribute(
        "href",
        "https://openlibrary.org/isbn/978-0-123456-78-9",
      );
    });

    it("does not show ISBN when isbn is absent", async () => {
      const user = userEvent.setup();
      renderResults([makeEntry({ isbn: undefined })]);
      await user.click(screen.getByText("A Great Paper"));

      expect(screen.queryByTestId("entry-isbn")).not.toBeInTheDocument();
    });
  });

  describe("Expanded view - entry type badge", () => {
    it("shows exactly one entry type badge when expanded (no duplicate)", async () => {
      const user = userEvent.setup();
      renderResults([makeEntry({ entry_type: "book" })]);
      await user.click(screen.getByText("A Great Paper"));

      const badges = screen.getAllByTestId("entry-type-badge");
      expect(badges).toHaveLength(1);
    });

    it("does not show entry type badge in expanded view for 'article' type", async () => {
      const user = userEvent.setup();
      renderResults([makeEntry({ entry_type: "article" })]);
      await user.click(screen.getByText("A Great Paper"));

      expect(screen.queryByTestId("entry-type-badge")).not.toBeInTheDocument();
    });
  });

  describe("Expanded view - no empty container div", () => {
    it("does not render the isbn/badge container when entry_type is hidden and isbn is absent", async () => {
      const user = userEvent.setup();
      renderResults([
        makeEntry({ entry_type: "article", isbn: undefined }),
      ]);
      await user.click(screen.getByText("A Great Paper"));

      // The expanded section should not contain an empty div with the gap class
      const expandedSection = screen.getByText("Smith, Alice; Jones, Bob").parentElement!;
      const emptyContainers = expandedSection.querySelectorAll(".mt-1.flex.flex-wrap");
      expect(emptyContainers).toHaveLength(0);
    });

    it("renders the isbn container when isbn is present even for hidden entry types", async () => {
      const user = userEvent.setup();
      renderResults([
        makeEntry({ entry_type: "article", isbn: "978-0-123456-78-9" }),
      ]);
      await user.click(screen.getByText("A Great Paper"));

      expect(screen.getByTestId("entry-isbn")).toBeInTheDocument();
    });
  });

  describe("Graceful degradation", () => {
    it("renders entry with all optional fields absent", async () => {
      const user = userEvent.setup();
      renderResults([
        makeEntry({
          journal: undefined,
          publisher: undefined,
          isbn: undefined,
          volume: undefined,
          number: undefined,
          pages: undefined,
          doi: undefined,
          abstract_text: undefined,
          entry_type: "article",
        }),
      ]);
      expect(screen.getByText("A Great Paper")).toBeInTheDocument();

      await user.click(screen.getByText("A Great Paper"));

      // Only authors should show in expanded view
      expect(screen.getByText("Smith, Alice; Jones, Bob")).toBeInTheDocument();
      expect(screen.queryByTestId("entry-publisher")).not.toBeInTheDocument();
      expect(screen.queryByTestId("entry-isbn")).not.toBeInTheDocument();
      expect(screen.queryByTestId("entry-type-badge")).not.toBeInTheDocument();
    });
  });
});

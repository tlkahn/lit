import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BibEntryActions } from "./BibEntryActions";
import type { BibEntry, BibKeyState } from "../lib/ipc";

const baseEntry: BibEntry = {
  key: "smith2024",
  authors: ["Smith, John"],
  title: "Test Paper",
  year: "2024",
  entry_type: "article",
  line_number: 1,
  bib_file: "/workspace/refs.bib",
  doi: "10.1000/test",
};

const handlers = () => ({
  onOpenNote: vi.fn(),
  onCreateNote: vi.fn(),
  onEnrich: vi.fn(),
  onOpenPdf: vi.fn(),
  onOcr: vi.fn(),
  onCopyCitation: vi.fn(),
  onDownloadPdf: vi.fn(),
  onLinkPdf: vi.fn(),
});

const defaultLoading = {
  materializingKey: null,
  enrichingKey: null,
  enrichPhase: "fetch" as const,
  downloadingKey: null,
  downloadProgress: null,
  linkingKey: null,
};

describe("BibEntryActions", () => {
  it("shows open-note button when state has page_id", () => {
    const h = handlers();
    const state: BibKeyState = { materialization: "materialized", page_id: "notes/smith.md" };
    render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} />,
    );
    const btn = screen.getByTestId("has-note-link");
    expect(btn).toHaveAttribute("aria-label", "Open note");
    expect(btn).toHaveAttribute("title", "Open note: notes/smith.md");
  });

  it("shows create-note button when state exists but no page_id", () => {
    const h = handlers();
    const state: BibKeyState = { materialization: "shadow", page_id: null };
    render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} />,
    );
    const btn = screen.getByTestId("create-note-btn");
    expect(btn).toHaveAttribute("aria-label", "Create note");
  });

  it("shows Creating… label when materializing", () => {
    const h = handlers();
    const state: BibKeyState = { materialization: "shadow", page_id: null };
    render(
      <BibEntryActions
        entry={baseEntry}
        state={state}
        {...h}
        {...defaultLoading}
        materializingKey="smith2024"
      />,
    );
    const btn = screen.getByTestId("create-note-btn");
    expect(btn).toHaveAttribute("aria-label", "Creating…");
    expect(btn).toBeDisabled();
  });

  it("shows fetch-details button when no page_id", () => {
    const h = handlers();
    const state: BibKeyState = { materialization: "shadow", page_id: null };
    render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} />,
    );
    expect(screen.getByTestId("fetch-details-btn")).toBeInTheDocument();
  });

  it("hides fetch-details when state has page_id", () => {
    const h = handlers();
    const state: BibKeyState = { materialization: "materialized", page_id: "notes/smith.md" };
    render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} />,
    );
    expect(screen.queryByTestId("fetch-details-btn")).not.toBeInTheDocument();
  });

  it("shows open-pdf and ocr buttons when entry has file", () => {
    const h = handlers();
    const entry = { ...baseEntry, file: "papers/smith.pdf" };
    const state: BibKeyState = { materialization: "materialized", page_id: "notes/smith.md" };
    render(
      <BibEntryActions entry={entry} state={state} {...h} {...defaultLoading} />,
    );
    expect(screen.getByTestId("open-pdf-btn")).toBeInTheDocument();
    expect(screen.getByTestId("ocr-btn")).toBeInTheDocument();
  });

  it("shows download-pdf button when no file and has doi", () => {
    const h = handlers();
    const state: BibKeyState = { materialization: "shadow", page_id: null };
    render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} />,
    );
    expect(screen.getByTestId("download-pdf-btn")).toBeInTheDocument();
  });

  it("hides download-pdf when entry has file", () => {
    const h = handlers();
    const entry = { ...baseEntry, file: "papers/smith.pdf" };
    const state: BibKeyState = { materialization: "materialized", page_id: "notes/smith.md" };
    render(
      <BibEntryActions entry={entry} state={state} {...h} {...defaultLoading} />,
    );
    expect(screen.queryByTestId("download-pdf-btn")).not.toBeInTheDocument();
  });

  it("always shows link-pdf and copy-citation buttons", () => {
    const h = handlers();
    render(
      <BibEntryActions entry={baseEntry} state={undefined} {...h} {...defaultLoading} />,
    );
    expect(screen.getByTestId("link-pdf-btn")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy citation" })).toBeInTheDocument();
  });

  it("calls onOpenNote when open-note button is clicked", () => {
    const h = handlers();
    const state: BibKeyState = { materialization: "materialized", page_id: "notes/smith.md" };
    render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} />,
    );
    fireEvent.click(screen.getByTestId("has-note-link"));
    expect(h.onOpenNote).toHaveBeenCalledWith("notes/smith.md");
  });

  it("calls onCreateNote when create-note button is clicked", () => {
    const h = handlers();
    const state: BibKeyState = { materialization: "shadow", page_id: null };
    render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} />,
    );
    fireEvent.click(screen.getByTestId("create-note-btn"));
    expect(h.onCreateNote).toHaveBeenCalledWith("smith2024");
  });

  it("calls onCopyCitation when copy button is clicked", () => {
    const h = handlers();
    render(
      <BibEntryActions entry={baseEntry} state={undefined} {...h} {...defaultLoading} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy citation" }));
    expect(h.onCopyCitation).toHaveBeenCalledWith("smith2024");
  });

  it("shows link-pdf label as 'Re-link PDF' when entry has file", () => {
    const h = handlers();
    const entry = { ...baseEntry, file: "papers/smith.pdf" };
    const state: BibKeyState = { materialization: "materialized", page_id: "notes/smith.md" };
    render(
      <BibEntryActions entry={entry} state={state} {...h} {...defaultLoading} />,
    );
    expect(screen.getByTestId("link-pdf-btn")).toHaveAttribute("aria-label", "Re-link PDF");
  });

  it("shows Linking… label when linkingKey matches", () => {
    const h = handlers();
    render(
      <BibEntryActions
        entry={baseEntry}
        state={undefined}
        {...h}
        {...defaultLoading}
        linkingKey="smith2024"
      />,
    );
    expect(screen.getByTestId("link-pdf-btn")).toHaveAttribute("aria-label", "Linking…");
  });
});

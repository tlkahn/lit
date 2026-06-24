import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, mockListen, resetListenMock } from "../test/tauri-mock";
import { RefChildList, type RefChildListProps } from "./RefChildList";
import { useWorkspaceStore } from "../stores/workspace";
import type { BibEntry } from "../lib/ipc";

const childEntry: BibEntry = {
  key: "jones2020",
  authors: ["Jones, A."],
  title: "Child Reference",
  year: "2020",
  entry_type: "article",
  line_number: 1,
  bib_file: "/workspace/refs.bib",
  doi: "10.1234/jones",
};

const defaultHandlers = () => ({
  onDrillDown: vi.fn(),
  onBack: vi.fn(),
  onNavigateToBibFile: vi.fn(),
  onOpenNote: vi.fn(),
  onCreateNote: vi.fn(),
  onEnrich: vi.fn(),
  onOpenPdf: vi.fn(),
  onOpenMarkdown: vi.fn(),
  onOcr: vi.fn(),
  onCopyCitation: vi.fn(),
  onDownloadPdf: vi.fn(),
  onLinkPdf: vi.fn(),
});

function renderRefChildList(overrides: Partial<RefChildListProps> = {}) {
  const props: RefChildListProps = {
    parentKey: "parent2020",
    parentTitle: "Parent Reference",
    paneId: "test-pane",
    workspacePath: "/workspace",
    refCounts: {},
    bibKeyStates: { jones2020: { materialization: "shadow", page_id: null } },
    modHeld: false,
    materializingKey: null,
    enrichingKey: null,
    enrichPhase: "fetch",
    downloadingKey: null,
    downloadProgress: null,
    linkingKey: null,
    ocrCompanionCurrentMap: {},
    ...defaultHandlers(),
    ...overrides,
  };
  return render(<RefChildList {...props} />);
}

async function expandEntry() {
  const title = await screen.findByTestId("reference-entry-title");
  const user = userEvent.setup();
  await user.click(title);
}

beforeEach(() => {
  resetListenMock();
  mockListen();
  mockInvoke((cmd) => {
    if (cmd === "get_references") return [childEntry];
    if (cmd === "get_citing_pages") return [];
    throw new Error(`Unknown command: ${cmd}`);
  });
  useWorkspaceStore.setState({
    workspacePath: "/workspace",
    currentPagePath: null,
    graphReady: false,
  });
});

describe("RefChildList — smoke", () => {
  it("renders the child entry title", async () => {
    renderRefChildList();
    expect(await screen.findByText("Child Reference")).toBeInTheDocument();
  });
});

describe("RefChildList — isMaterializing", () => {
  it("shows Creating… and disabled when materializingKey matches", async () => {
    renderRefChildList({ materializingKey: "jones2020" });
    await expandEntry();
    const btn = screen.getByTestId("create-note-btn");
    expect(btn).toHaveAttribute("aria-label", "Creating…");
    expect(btn).toBeDisabled();
  });

  it("shows Create note and enabled when materializingKey is different", async () => {
    renderRefChildList({ materializingKey: "other" });
    await expandEntry();
    const btn = screen.getByTestId("create-note-btn");
    expect(btn).toHaveAttribute("aria-label", "Create note");
    expect(btn).not.toBeDisabled();
  });
});

describe("RefChildList — isEnriching + enrichPhase", () => {
  it("shows Fetching… when enrichingKey matches and phase is fetch", async () => {
    renderRefChildList({ enrichingKey: "jones2020", enrichPhase: "fetch" });
    await expandEntry();
    const btn = screen.getByTestId("fetch-details-btn");
    expect(btn).toHaveAttribute("aria-label", "Fetching…");
    expect(btn).toBeDisabled();
  });

  it("shows Searching providers… when enrichingKey matches and phase is search", async () => {
    renderRefChildList({ enrichingKey: "jones2020", enrichPhase: "search" });
    await expandEntry();
    const btn = screen.getByTestId("fetch-details-btn");
    expect(btn).toHaveAttribute("aria-label", "Searching providers…");
    expect(btn).toBeDisabled();
  });

  it("is not disabled when enrichingKey is different", async () => {
    renderRefChildList({ enrichingKey: "other" });
    await expandEntry();
    const btn = screen.getByTestId("fetch-details-btn");
    expect(btn).not.toBeDisabled();
  });
});

describe("RefChildList — isDownloading + downloadProgress", () => {
  it("disables download button when downloadingKey matches", async () => {
    renderRefChildList({ downloadingKey: "jones2020", downloadProgress: null });
    await expandEntry();
    const btn = screen.getByTestId("download-pdf-btn");
    expect(btn).toBeDisabled();
  });

  it("shows percentage when downloadingKey matches with progress", async () => {
    renderRefChildList({
      downloadingKey: "jones2020",
      downloadProgress: { bytes: 500, total: 1000 },
    });
    await expandEntry();
    const btn = screen.getByTestId("download-pdf-btn");
    expect(btn.textContent).toContain("50%");
  });

  it("is not disabled when downloadingKey is different", async () => {
    renderRefChildList({ downloadingKey: "other" });
    await expandEntry();
    const btn = screen.getByTestId("download-pdf-btn");
    expect(btn).not.toBeDisabled();
  });
});

describe("RefChildList — isLinking", () => {
  it("shows Linking… and disabled when linkingKey matches", async () => {
    renderRefChildList({ linkingKey: "jones2020" });
    await expandEntry();
    const btn = screen.getByTestId("link-pdf-btn");
    expect(btn).toHaveAttribute("aria-label", "Linking…");
    expect(btn).toBeDisabled();
  });

  it("is not disabled when linkingKey is null", async () => {
    renderRefChildList({ linkingKey: null });
    await expandEntry();
    const btn = screen.getByTestId("link-pdf-btn");
    expect(btn).not.toBeDisabled();
  });
});

describe("RefChildList — ocrCompanionCurrentMap", () => {
  it("shows open-markdown button when map has a string value for the entry", async () => {
    renderRefChildList({
      ocrCompanionCurrentMap: { "/workspace/refs.bib:jones2020": "jones2020-ocr.md" },
    });
    await expandEntry();
    expect(screen.getByTestId("open-markdown-btn")).toBeInTheDocument();
  });

  it("hides open-markdown button when map value is false", async () => {
    renderRefChildList({
      ocrCompanionCurrentMap: { "/workspace/refs.bib:jones2020": false },
    });
    await expandEntry();
    expect(screen.queryByTestId("open-markdown-btn")).not.toBeInTheDocument();
  });

  it("hides open-markdown button when map is empty", async () => {
    renderRefChildList({ ocrCompanionCurrentMap: {} });
    await expandEntry();
    expect(screen.queryByTestId("open-markdown-btn")).not.toBeInTheDocument();
  });
});

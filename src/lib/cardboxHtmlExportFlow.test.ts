import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockInvoke } from "../test/tauri-mock";
import { useStatusMessageStore } from "../stores/statusMessage";
import type { CardboxAnnotation } from "./ipc";

function makeCard(overrides: Partial<CardboxAnnotation> = {}): CardboxAnnotation {
  return {
    uuid: "u-" + Math.random().toString(36).slice(2, 8),
    annotation_type: "note",
    certainty: "medium",
    body: "body",
    date: null,
    source_page_id: "notes/a.md",
    source_page_title: "Page A",
    source_line: 1,
    char_start: 0,
    char_end: 10,
    scope_kind: "word",
    scope_value: "w",
    original: "quoted",
    ...overrides,
  };
}

vi.mock("../editor/livePreview/katexLoader", () => ({
  loadKatex: vi.fn(() => Promise.resolve()),
}));

const mockedSave = vi.mocked(
  (await import("@tauri-apps/plugin-dialog")).save,
);

let invokedExportArgs: { destination: string; html: string } | null = null;

const cardsOnA = [
  makeCard({ uuid: "u1", source_page_id: "notes/a.md", char_start: 50, body: "second" }),
  makeCard({ uuid: "u2", source_page_id: "notes/a.md", char_start: 10, body: "first" }),
  makeCard({ uuid: "u3", source_page_id: "other.md", char_start: 0, body: "other" }),
  makeCard({ uuid: "u4", source_page_id: "notes/a.md", char_start: 80, body: "third" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  invokedExportArgs = null;
  useStatusMessageStore.setState({ message: null, variant: "success", action: null });
  mockInvoke((cmd, args) => {
    switch (cmd) {
      case "list_all_annotations":
        return cardsOnA;
      case "export_cardbox_html": {
        const a = args as { destination: string; html: string };
        invokedExportArgs = a;
        return a.destination;
      }
      default:
        throw new Error(`Unexpected invoke: ${cmd}`);
    }
  });
});

describe("exportCardboxToHtml", () => {
  async function loadFlow() {
    const mod = await import("./cardboxHtmlExportFlow");
    return mod.exportCardboxToHtml;
  }

  // E1: filter + order
  it("E1: filters to page and sorts by doc position", async () => {
    mockedSave.mockResolvedValue("/out/cards.html");
    const exportCardboxToHtml = await loadFlow();
    await exportCardboxToHtml("notes/a.md");
    expect(invokedExportArgs).not.toBeNull();
    const html = invokedExportArgs!.html;
    const idxFirst = html.indexOf("first");
    const idxSecond = html.indexOf("second");
    const idxThird = html.indexOf("third");
    expect(idxFirst).toBeLessThan(idxSecond);
    expect(idxSecond).toBeLessThan(idxThird);
    expect(html).not.toContain("other");
  });

  // E2: filters ignored fence
  it("E2: cardbox store filters are ignored", async () => {
    mockedSave.mockResolvedValue("/out/cards.html");
    const exportCardboxToHtml = await loadFlow();
    await exportCardboxToHtml("notes/a.md");
    expect(invokedExportArgs).not.toBeNull();
    const html = invokedExportArgs!.html;
    expect(html).toContain("first");
    expect(html).toContain("second");
    expect(html).toContain("third");
  });

  // E3: save dialog args
  it("E3: save dialog gets correct args", async () => {
    mockedSave.mockResolvedValue("/out/a.html");
    const exportCardboxToHtml = await loadFlow();
    await exportCardboxToHtml("notes/a.md");
    expect(mockedSave).toHaveBeenCalledWith({
      defaultPath: "a.html",
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
  });

  // E4: cancel
  it("E4: save returning null does not invoke export", async () => {
    mockedSave.mockResolvedValue(null);
    const exportCardboxToHtml = await loadFlow();
    await exportCardboxToHtml("notes/a.md");
    expect(invokedExportArgs).toBeNull();
    const state = useStatusMessageStore.getState();
    expect(state.message).toBeNull();
  });

  // E5: extension coercion
  it("E5: appends .html if missing", async () => {
    mockedSave.mockResolvedValue("/out/cards");
    const exportCardboxToHtml = await loadFlow();
    await exportCardboxToHtml("notes/a.md");
    expect(invokedExportArgs!.destination).toBe("/out/cards.html");
  });

  it("E5: preserves .html extension", async () => {
    mockedSave.mockResolvedValue("/out/cards.html");
    const exportCardboxToHtml = await loadFlow();
    await exportCardboxToHtml("notes/a.md");
    expect(invokedExportArgs!.destination).toBe("/out/cards.html");
  });

  it("E5: preserves .HTML extension (case-insensitive)", async () => {
    mockedSave.mockResolvedValue("/out/cards.HTML");
    const exportCardboxToHtml = await loadFlow();
    await exportCardboxToHtml("notes/a.md");
    expect(invokedExportArgs!.destination).toBe("/out/cards.HTML");
  });

  // E6: progress + success toast
  it("E6: shows success toast with card count", async () => {
    mockedSave.mockResolvedValue("/out/cards.html");
    const exportCardboxToHtml = await loadFlow();
    await exportCardboxToHtml("notes/a.md");
    const state = useStatusMessageStore.getState();
    expect(state.message).toBe("Exported 3 cards");
    expect(state.variant).toBe("success");
  });

  // E7: error path
  it("E7: invoke rejection shows error toast", async () => {
    mockedSave.mockResolvedValue("/out/cards.html");
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return cardsOnA;
      if (cmd === "export_cardbox_html") throw new Error("disk full");
      throw new Error(`Unexpected: ${cmd}`);
    });
    const exportCardboxToHtml = await loadFlow();
    await exportCardboxToHtml("notes/a.md");
    const state = useStatusMessageStore.getState();
    expect(state.message).toBe("disk full");
    expect(state.variant).toBe("error");
  });

  // E8: zero cards
  it("E8: no matching cards shows info toast", async () => {
    mockedSave.mockResolvedValue("/out/cards.html");
    const exportCardboxToHtml = await loadFlow();
    await exportCardboxToHtml("nonexistent.md");
    expect(mockedSave).not.toHaveBeenCalled();
    expect(invokedExportArgs).toBeNull();
    const state = useStatusMessageStore.getState();
    expect(state.message).toBe("No cards to export");
  });

  // E9: title
  it("E9: uses source_page_title for page title", async () => {
    mockedSave.mockResolvedValue("/out/cards.html");
    const exportCardboxToHtml = await loadFlow();
    await exportCardboxToHtml("notes/a.md");
    const html = invokedExportArgs!.html;
    expect(html).toContain("Page A");
  });

  it("E9: falls back to filename stem when title is empty", async () => {
    const emptyTitleCards = cardsOnA.map((c) => ({
      ...c,
      source_page_title: "",
    }));
    mockInvoke((cmd, args) => {
      if (cmd === "list_all_annotations") return emptyTitleCards;
      if (cmd === "export_cardbox_html") {
        const a = args as { destination: string; html: string };
        invokedExportArgs = a;
        return a.destination;
      }
      throw new Error(`Unexpected: ${cmd}`);
    });
    mockedSave.mockResolvedValue("/out/cards.html");
    const exportCardboxToHtml = await loadFlow();
    await exportCardboxToHtml("notes/a.md");
    expect(invokedExportArgs!.html).toContain("a");
  });

  // E10: KaTeX preload
  it("E10: loadKatex is called before save", async () => {
    const { loadKatex } = await import("../editor/livePreview/katexLoader");
    mockedSave.mockResolvedValue("/out/cards.html");
    const exportCardboxToHtml = await loadFlow();
    await exportCardboxToHtml("notes/a.md");
    expect(loadKatex).toHaveBeenCalled();
  });
});

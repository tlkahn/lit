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

vi.mock("./renderMarkdown", () => ({
  renderMarkdown: vi.fn((text: string) =>
    text.includes("$")
      ? '<span class="cm-preview-math-inline">x</span>'
      : `<p>${text}</p>`,
  ),
  renderInlineMarkdown: vi.fn((text: string) => `<span>${text}</span>`),
}));

const mockedSave = vi.mocked(
  (await import("@tauri-apps/plugin-dialog")).save,
);

interface InvokedAnkiArgs {
  destination: string;
  deckName: string;
  deckKey: string;
  notes: Array<{ uuid: string; front_html: string; back_html: string }>;
  modelCss: string | null;
}

let invokedAnkiArgs: InvokedAnkiArgs | null = null;

const cardsOnA = [
  makeCard({ uuid: "u1", source_page_id: "notes/a.md", char_start: 50, body: "second" }),
  makeCard({ uuid: "u2", source_page_id: "notes/a.md", char_start: 10, body: "first" }),
  makeCard({ uuid: "u3", source_page_id: "other.md", char_start: 0, body: "other" }),
  makeCard({ uuid: "u4", source_page_id: "notes/a.md", char_start: 80, body: "third" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  invokedAnkiArgs = null;
  useStatusMessageStore.setState({ message: null, variant: "success", action: null });
  mockInvoke((cmd, args) => {
    switch (cmd) {
      case "list_all_annotations":
        return cardsOnA;
      case "export_cardbox_anki": {
        invokedAnkiArgs = args as unknown as InvokedAnkiArgs;
        return invokedAnkiArgs.destination;
      }
      default:
        throw new Error(`Unexpected invoke: ${cmd}`);
    }
  });
});

describe("exportCardboxToAnki", () => {
  async function loadFlow() {
    const mod = await import("./cardboxAnkiExportFlow");
    return mod.exportCardboxToAnki;
  }

  // F1: filter + order
  it("F1: filters to page, sorts by doc position, other pages excluded", async () => {
    mockedSave.mockResolvedValue("/out/cards.apkg");
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    expect(invokedAnkiArgs).not.toBeNull();
    const uuids = invokedAnkiArgs!.notes.map((n) => n.uuid);
    expect(uuids).toEqual(["u2", "u1", "u4"]);
    expect(invokedAnkiArgs!.notes.map((n) => n.front_html)).not.toContain(
      expect.stringContaining("other"),
    );
  });

  // F2: cardbox UI filters ignored fence
  it("F2: all page cards exported regardless of store filters", async () => {
    mockedSave.mockResolvedValue("/out/cards.apkg");
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    expect(invokedAnkiArgs!.notes).toHaveLength(3);
    expect(invokedAnkiArgs!.notes.map((n) => n.uuid)).toEqual(["u2", "u1", "u4"]);
  });

  // F3: save dialog args
  it("F3: save dialog gets .apkg default path and filter", async () => {
    mockedSave.mockResolvedValue("/out/a.apkg");
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    expect(mockedSave).toHaveBeenCalledWith({
      defaultPath: "a.apkg",
      filters: [{ name: "Anki Package", extensions: ["apkg"] }],
    });
  });

  // F4: cancel
  it("F4: save returning null does not invoke export", async () => {
    mockedSave.mockResolvedValue(null);
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    expect(invokedAnkiArgs).toBeNull();
    const state = useStatusMessageStore.getState();
    expect(state.message).toBeNull();
  });

  // F5: extension coercion
  it("F5a: appends .apkg if missing", async () => {
    mockedSave.mockResolvedValue("/out/cards");
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    expect(invokedAnkiArgs!.destination).toBe("/out/cards.apkg");
  });

  it("F5b: preserves .apkg extension", async () => {
    mockedSave.mockResolvedValue("/out/cards.apkg");
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    expect(invokedAnkiArgs!.destination).toBe("/out/cards.apkg");
  });

  it("F5c: preserves .APKG extension (case-insensitive)", async () => {
    mockedSave.mockResolvedValue("/out/cards.APKG");
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    expect(invokedAnkiArgs!.destination).toBe("/out/cards.APKG");
  });

  // F6: success toast
  it("F6: shows success toast with card count", async () => {
    mockedSave.mockResolvedValue("/out/cards.apkg");
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    const state = useStatusMessageStore.getState();
    expect(state.message).toBe("Exported 3 cards");
    expect(state.variant).toBe("success");
  });

  // F7: error path
  it("F7: invoke rejection shows error toast", async () => {
    mockedSave.mockResolvedValue("/out/cards.apkg");
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return cardsOnA;
      if (cmd === "export_cardbox_anki") throw new Error("disk full");
      throw new Error(`Unexpected: ${cmd}`);
    });
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    const state = useStatusMessageStore.getState();
    expect(state.message).toBe("disk full");
    expect(state.variant).toBe("error");
  });

  // F8: zero cards
  it("F8: no matching cards shows info toast without save dialog", async () => {
    mockedSave.mockResolvedValue("/out/cards.apkg");
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("nonexistent.md");
    expect(mockedSave).not.toHaveBeenCalled();
    expect(invokedAnkiArgs).toBeNull();
    const state = useStatusMessageStore.getState();
    expect(state.message).toBe("No cards to export");
    expect(state.variant).toBe("info");
  });

  // F9: deck name
  it("F9a: deck name uses source_page_title of first sorted card", async () => {
    mockedSave.mockResolvedValue("/out/cards.apkg");
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    expect(invokedAnkiArgs!.deckName).toBe("Page A");
  });

  // F9c: deck key is the page path (deck identity)
  it("F9c: deckKey is the exported page path", async () => {
    mockedSave.mockResolvedValue("/out/cards.apkg");
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    expect(invokedAnkiArgs!.deckKey).toBe("notes/a.md");
  });

  it("F9b: falls back to filename stem when title is empty", async () => {
    const emptyTitleCards = cardsOnA.map((c) => ({ ...c, source_page_title: "" }));
    mockInvoke((cmd, args) => {
      if (cmd === "list_all_annotations") return emptyTitleCards;
      if (cmd === "export_cardbox_anki") {
        invokedAnkiArgs = args as unknown as InvokedAnkiArgs;
        return invokedAnkiArgs.destination;
      }
      throw new Error(`Unexpected: ${cmd}`);
    });
    mockedSave.mockResolvedValue("/out/cards.apkg");
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    expect(invokedAnkiArgs!.deckName).toBe("a");
  });

  // F10: dialog before loadKatex
  it("F10a: cancel path does not call loadKatex", async () => {
    const { loadKatex } = await import("../editor/livePreview/katexLoader");
    mockedSave.mockResolvedValue(null);
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    expect(mockedSave).toHaveBeenCalled();
    expect(loadKatex).not.toHaveBeenCalled();
  });

  it("F10b: on success, save dialog is called before loadKatex", async () => {
    const { loadKatex } = await import("../editor/livePreview/katexLoader");
    const callOrder: string[] = [];
    mockedSave.mockImplementation(async () => {
      callOrder.push("save");
      return "/out/cards.apkg";
    });
    vi.mocked(loadKatex).mockImplementation((async () => {
      callOrder.push("loadKatex");
    }) as unknown as typeof loadKatex);
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    expect(callOrder.indexOf("save")).toBeLessThan(callOrder.indexOf("loadKatex"));
  });

  // F11: error handling
  it("F11a: list_all_annotations rejection shows error toast", async () => {
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") throw new Error("DB locked");
      throw new Error(`Unexpected: ${cmd}`);
    });
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    const state = useStatusMessageStore.getState();
    expect(state.message).toBe("DB locked");
    expect(state.variant).toBe("error");
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it("F11b: loadKatex rejection shows error toast", async () => {
    const { loadKatex } = await import("../editor/livePreview/katexLoader");
    vi.mocked(loadKatex).mockRejectedValueOnce(new Error("KaTeX failed"));
    mockedSave.mockResolvedValue("/out/cards.apkg");
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    const state = useStatusMessageStore.getState();
    expect(state.message).toBe("KaTeX failed");
    expect(state.variant).toBe("error");
    expect(invokedAnkiArgs).toBeNull();
  });

  // F12: empty-back annotation
  it("F12: annotation with blank original is included with back_html empty", async () => {
    const withEmptyBack = cardsOnA.map((c) =>
      c.uuid === "u2" ? { ...c, original: "   " } : c,
    );
    mockInvoke((cmd, args) => {
      if (cmd === "list_all_annotations") return withEmptyBack;
      if (cmd === "export_cardbox_anki") {
        invokedAnkiArgs = args as unknown as InvokedAnkiArgs;
        return invokedAnkiArgs.destination;
      }
      throw new Error(`Unexpected: ${cmd}`);
    });
    mockedSave.mockResolvedValue("/out/cards.apkg");
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    expect(invokedAnkiArgs!.notes).toHaveLength(3);
    const emptyBack = invokedAnkiArgs!.notes.find((n) => n.uuid === "u2");
    expect(emptyBack).toBeDefined();
    expect(emptyBack!.back_html).toBe("");
  });

  // F13: KaTeX css
  it("F13a: modelCss includes KaTeX css when math is present", async () => {
    const mathCards = cardsOnA.map((c) =>
      c.uuid === "u1" ? { ...c, body: "$x^2$" } : c,
    );
    mockInvoke((cmd, args) => {
      if (cmd === "list_all_annotations") return mathCards;
      if (cmd === "export_cardbox_anki") {
        invokedAnkiArgs = args as unknown as InvokedAnkiArgs;
        return invokedAnkiArgs.destination;
      }
      throw new Error(`Unexpected: ${cmd}`);
    });
    mockedSave.mockResolvedValue("/out/cards.apkg");
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    expect(invokedAnkiArgs!.modelCss).not.toBeNull();
    expect(invokedAnkiArgs!.modelCss).toContain(".katex");
  });

  it("F13b: modelCss omitted when no math", async () => {
    mockedSave.mockResolvedValue("/out/cards.apkg");
    const exportCardboxToAnki = await loadFlow();
    await exportCardboxToAnki("notes/a.md");
    expect(invokedAnkiArgs!.modelCss).toBeNull();
  });
});

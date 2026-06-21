import { describe, it, expect, vi, afterEach } from "vitest";

import {
  REVEAL_IN_FILE_TREE,
  REVEAL_BIB_ENTRY_FOR_PAGE,
  REVEAL_BIB_ENTRY,
  SET_SIDEBAR_TAB,
  dispatchRevealInFileTree,
  dispatchRevealBibEntryForPage,
  dispatchRevealBibEntry,
  dispatchSetSidebarTab,
  onRevealInFileTree,
  onRevealBibEntryForPage,
  onRevealBibEntry,
  onSetSidebarTab,
} from "./sidebarEvents";

describe("sidebarEvents", () => {
  afterEach(() => {
    // Clean up any lingering listeners (tests add/remove their own)
  });

  it("dispatchRevealInFileTree dispatches event with correct name and detail", () => {
    const cb = vi.fn();
    window.addEventListener(REVEAL_IN_FILE_TREE, cb);

    dispatchRevealInFileTree("docs/readme.md");

    expect(cb).toHaveBeenCalledTimes(1);
    const event = cb.mock.calls[0]![0] as CustomEvent;
    expect(event.type).toBe("lit:reveal-in-file-tree");
    expect(event.detail).toEqual({ relativePath: "docs/readme.md" });

    window.removeEventListener(REVEAL_IN_FILE_TREE, cb);
  });

  it("onRevealInFileTree subscribes and passes typed detail to callback", () => {
    const cb = vi.fn();
    const unsub = onRevealInFileTree(cb);

    window.dispatchEvent(
      new CustomEvent("lit:reveal-in-file-tree", {
        detail: { relativePath: "foo.md" },
      }),
    );

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ relativePath: "foo.md" });

    unsub();
  });

  it("onRevealInFileTree returns unsubscribe function", () => {
    const cb = vi.fn();
    const unsub = onRevealInFileTree(cb);

    // First dispatch should be received
    window.dispatchEvent(
      new CustomEvent("lit:reveal-in-file-tree", {
        detail: { relativePath: "a.md" },
      }),
    );
    expect(cb).toHaveBeenCalledTimes(1);

    // Unsubscribe
    unsub();

    // Second dispatch should NOT be received
    window.dispatchEvent(
      new CustomEvent("lit:reveal-in-file-tree", {
        detail: { relativePath: "b.md" },
      }),
    );
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("dispatchRevealBibEntry includes optional bibFile", () => {
    const cb = vi.fn();
    window.addEventListener(REVEAL_BIB_ENTRY, cb);

    dispatchRevealBibEntry("smith2024", "refs.bib");

    expect(cb).toHaveBeenCalledTimes(1);
    const event = cb.mock.calls[0]![0] as CustomEvent;
    expect(event.type).toBe("lit:reveal-bib-entry");
    expect(event.detail).toEqual({ citekey: "smith2024", bibFile: "refs.bib" });

    window.removeEventListener(REVEAL_BIB_ENTRY, cb);
  });

  it("dispatchRevealBibEntry omits bibFile when not provided", () => {
    const cb = vi.fn();
    window.addEventListener(REVEAL_BIB_ENTRY, cb);

    dispatchRevealBibEntry("smith2024");

    expect(cb).toHaveBeenCalledTimes(1);
    const event = cb.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.bibFile).toBeUndefined();

    window.removeEventListener(REVEAL_BIB_ENTRY, cb);
  });

  it("dispatchSetSidebarTab dispatches tab value as detail", () => {
    const cb = vi.fn();
    window.addEventListener(SET_SIDEBAR_TAB, cb);

    dispatchSetSidebarTab("references");

    expect(cb).toHaveBeenCalledTimes(1);
    const event = cb.mock.calls[0]![0] as CustomEvent;
    expect(event.type).toBe("lit:set-sidebar-tab");
    expect(event.detail).toBe("references");

    window.removeEventListener(SET_SIDEBAR_TAB, cb);
  });

  it("onRevealBibEntryForPage round-trips correctly", () => {
    const cb = vi.fn();
    const unsub = onRevealBibEntryForPage(cb);

    dispatchRevealBibEntryForPage("notes/page.md");

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ relativePath: "notes/page.md" });

    unsub();

    // Verify the constant matches the expected event name
    expect(REVEAL_BIB_ENTRY_FOR_PAGE).toBe("lit:reveal-bib-entry-for-page");
  });

  it("onRevealBibEntry round-trips correctly", () => {
    const cb = vi.fn();
    const unsub = onRevealBibEntry(cb);

    dispatchRevealBibEntry("doe2023", "main.bib");

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ citekey: "doe2023", bibFile: "main.bib" });

    unsub();
  });

  it("onSetSidebarTab round-trips correctly", () => {
    const cb = vi.fn();
    const unsub = onSetSidebarTab(cb);

    dispatchSetSidebarTab("outline");

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith("outline");

    unsub();
  });
});

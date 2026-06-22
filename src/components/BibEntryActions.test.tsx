import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BibEntryActions, ActionButton } from "./BibEntryActions";
import type { BibActionDescriptor } from "./BibEntryActions";
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
  onOpenMarkdown: vi.fn(),
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

  it("hides fetch-details button for partial materialization without page_id", () => {
    const h = handlers();
    const state: BibKeyState = { materialization: "partial", page_id: null };
    render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} />,
    );
    expect(screen.queryByTestId("fetch-details-btn")).not.toBeInTheDocument();
  });

  it("keeps fetch-details button visible during enrichment even when materialization flips to partial", () => {
    const h = handlers();
    const state: BibKeyState = { materialization: "partial", page_id: null };
    render(
      <BibEntryActions
        entry={baseEntry}
        state={state}
        {...h}
        {...defaultLoading}
        enrichingKey="smith2024"
      />,
    );
    const btn = screen.getByTestId("fetch-details-btn");
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-label", "Fetching…");
  });

  it("shows open-markdown button when ocrCompanionCurrent is true", () => {
    const h = handlers();
    const state: BibKeyState = { materialization: "materialized", page_id: "notes/smith.md" };
    render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} ocrCompanionCurrent={true} />,
    );
    const btn = screen.getByTestId("open-markdown-btn");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-label", "Open markdown");
  });

  it("hides open-markdown button when ocrCompanionCurrent is false", () => {
    const h = handlers();
    const state: BibKeyState = { materialization: "materialized", page_id: "notes/smith.md" };
    render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} ocrCompanionCurrent={false} />,
    );
    expect(screen.queryByTestId("open-markdown-btn")).not.toBeInTheDocument();
  });

  it("hides open-markdown button when ocrCompanionCurrent is undefined", () => {
    const h = handlers();
    const state: BibKeyState = { materialization: "materialized", page_id: "notes/smith.md" };
    render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} />,
    );
    expect(screen.queryByTestId("open-markdown-btn")).not.toBeInTheDocument();
  });

  it("calls onOpenMarkdown with entry key when clicked", () => {
    const h = handlers();
    const state: BibKeyState = { materialization: "materialized", page_id: "notes/smith.md" };
    render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} ocrCompanionCurrent={true} />,
    );
    fireEvent.click(screen.getByTestId("open-markdown-btn"));
    expect(h.onOpenMarkdown).toHaveBeenCalledWith("smith2024");
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

  it("hides ocr button when ocrCompanionCurrent is true", () => {
    const h = handlers();
    const entry = { ...baseEntry, file: "papers/smith.pdf" };
    const state: BibKeyState = { materialization: "materialized", page_id: "notes/smith.md" };
    render(
      <BibEntryActions entry={entry} state={state} {...h} {...defaultLoading} ocrCompanionCurrent={true} />,
    );
    expect(screen.getByTestId("open-pdf-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("ocr-btn")).not.toBeInTheDocument();
  });

  it("shows ocr button when ocrCompanionCurrent is false", () => {
    const h = handlers();
    const entry = { ...baseEntry, file: "papers/smith.pdf" };
    const state: BibKeyState = { materialization: "materialized", page_id: "notes/smith.md" };
    render(
      <BibEntryActions entry={entry} state={state} {...h} {...defaultLoading} ocrCompanionCurrent={false} />,
    );
    expect(screen.getByTestId("open-pdf-btn")).toBeInTheDocument();
    expect(screen.getByTestId("ocr-btn")).toBeInTheDocument();
  });

  it("shows ocr button when ocrCompanionCurrent is undefined (default)", () => {
    const h = handlers();
    const entry = { ...baseEntry, file: "papers/smith.pdf" };
    const state: BibKeyState = { materialization: "materialized", page_id: "notes/smith.md" };
    render(
      <BibEntryActions entry={entry} state={state} {...h} {...defaultLoading} />,
    );
    expect(screen.getByTestId("open-pdf-btn")).toBeInTheDocument();
    expect(screen.getByTestId("ocr-btn")).toBeInTheDocument();
  });

  it("shows file path in open-pdf button tooltip", () => {
    const h = handlers();
    const entry = { ...baseEntry, file: "papers/smith.pdf" };
    const state: BibKeyState = { materialization: "materialized", page_id: "notes/smith.md" };
    render(
      <BibEntryActions entry={entry} state={state} {...h} {...defaultLoading} />,
    );
    const btn = screen.getByTestId("open-pdf-btn");
    expect(btn).toHaveAttribute("title", "Open PDF: papers/smith.pdf");
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

  it("restores hidden buttons when container widens (visibleCount ratchet bug)", () => {
    // Use a custom ResizeObserver that lets us trigger callbacks manually
    let roCallback: ResizeObserverCallback | null = null;
    const OriginalRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        roCallback = cb;
      }
      observe(_target: Element) {
        // Do NOT fire immediately — we'll trigger manually
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    const h = handlers();
    // baseEntry has doi and no file, state has no page_id => creates:
    // create-note, enrich, copy-citation, download-pdf, link-pdf = 5 buttons
    const state: BibKeyState = { materialization: "shadow", page_id: null };
    const { container } = render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} />,
    );

    const actionsContainer = container.querySelector("[data-bib-actions]") as HTMLElement;
    expect(actionsContainer).toBeTruthy();

    // Initially all 5 buttons are visible (visibleCount starts at actions.length)
    // The useLayoutEffect runs measure() which iterates children.
    // In jsdom offsetLeft/offsetWidth are 0 so measure() counts all children.
    // Let's simulate the initial "narrow" state by mocking DOM metrics.

    // Set narrow container width
    (actionsContainer as unknown as { _clientWidth: number })._clientWidth = 150;

    // Mock offsetLeft and offsetWidth on button children to simulate layout.
    // Each button is ~60px wide with gap of 6px between them.
    const BUTTON_WIDTH = 60;
    const GAP = 6;
    function mockChildWidths() {
      const children = actionsContainer.children;
      let left = 0;
      for (let i = 0; i < children.length; i++) {
        const child = children[i] as HTMLElement;
        if (child.hasAttribute("data-overflow-trigger")) {
          Object.defineProperty(child, "offsetLeft", { value: left, configurable: true });
          Object.defineProperty(child, "offsetWidth", { value: TRIGGER_WIDTH, configurable: true });
        } else {
          Object.defineProperty(child, "offsetLeft", { value: left, configurable: true });
          Object.defineProperty(child, "offsetWidth", { value: BUTTON_WIDTH, configurable: true });
          left += BUTTON_WIDTH + GAP;
        }
      }
    }

    const TRIGGER_WIDTH = 28;

    // Trigger measure() via ResizeObserver callback with narrow width
    mockChildWidths();
    act(() => {
      roCallback!(
        [{ target: actionsContainer, contentRect: actionsContainer.getBoundingClientRect(), borderBoxSize: [{ blockSize: 0, inlineSize: 150 }] } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    // After narrow measure: container is 150px, each button 60px, TRIGGER_WIDTH 28
    // Available width = 150 - 28 = 122px. First button right = 0+60 = 60 <= 122 (fits).
    // Second button right = 66+60 = 126 > 122 (doesn't fit). visibleCount = 1 or 2.
    // The overflow trigger should be visible.
    const overflowTrigger = actionsContainer.querySelector("[data-overflow-trigger]");
    expect(overflowTrigger).toBeTruthy();

    // Now simulate widening the container to 600px — all 5 should fit.
    (actionsContainer as unknown as { _clientWidth: number })._clientWidth = 600;

    // Re-mock child widths with new layout
    mockChildWidths();
    act(() => {
      roCallback!(
        [{ target: actionsContainer, contentRect: actionsContainer.getBoundingClientRect(), borderBoxSize: [{ blockSize: 0, inlineSize: 600 }] } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    // After widening: all 5 buttons should be visible in the row, no overflow.
    // 5 buttons * 60px + 4 gaps * 6px = 324px, well within 600-28=572px.
    const visibleButtons = actionsContainer.querySelectorAll("button:not([data-overflow-trigger])");
    expect(visibleButtons.length).toBe(5);
    // The overflow trigger should be gone
    const overflowTriggerAfter = actionsContainer.querySelector("[data-overflow-trigger]");
    expect(overflowTriggerAfter).toBeNull();

    // Restore original ResizeObserver
    globalThis.ResizeObserver = OriginalRO;
  });

  it("does not show overflow menu when all buttons fit without trigger", () => {
    // Set up manual ResizeObserver so we control when measure() fires
    let roCallback: ResizeObserverCallback | null = null;
    const OriginalRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        roCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    const h = handlers();
    // baseEntry has doi, no file, shadow state => 5 buttons:
    // create-note, enrich, copy-citation, download-pdf, link-pdf
    const state: BibKeyState = { materialization: "shadow", page_id: null };
    const { container } = render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} />,
    );

    const actionsContainer = container.querySelector("[data-bib-actions]") as HTMLElement;
    expect(actionsContainer).toBeTruthy();

    const BUTTON_WIDTH = 60;
    const TRIG_WIDTH = 28;

    // 5 buttons at 60px each + 4 gaps at 6px = 324px total.
    // Container = 350px. All buttons fit (324 < 350), but the buggy code
    // checks against 350 - 28 = 322, which excludes the last button.
    (actionsContainer as unknown as { _clientWidth: number })._clientWidth = 350;

    function mockChildWidths() {
      const children = actionsContainer.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i] as HTMLElement;
        if (child.hasAttribute("data-overflow-trigger")) {
          Object.defineProperty(child, "offsetWidth", { value: TRIG_WIDTH, configurable: true });
        } else {
          Object.defineProperty(child, "offsetWidth", { value: BUTTON_WIDTH, configurable: true });
        }
      }
    }

    mockChildWidths();
    act(() => {
      roCallback!(
        [{ target: actionsContainer, contentRect: actionsContainer.getBoundingClientRect(), borderBoxSize: [{ blockSize: 0, inlineSize: 350 }] } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    // All 5 buttons should be visible, no overflow trigger
    const visibleButtons = actionsContainer.querySelectorAll("button:not([data-overflow-trigger])");
    expect(visibleButtons.length).toBe(5);
    expect(actionsContainer.querySelector("[data-overflow-trigger]")).toBeNull();

    globalThis.ResizeObserver = OriginalRO;
  });

  it("applies gap-1 to download-pdf button when downloading (renderContent present)", () => {
    const h = handlers();
    const state: BibKeyState = { materialization: "shadow", page_id: null };
    render(
      <BibEntryActions
        entry={baseEntry}
        state={state}
        {...h}
        {...defaultLoading}
        downloadingKey="smith2024"
        downloadProgress={{ bytes: 50, total: 100 }}
      />,
    );
    const btn = screen.getByTestId("download-pdf-btn");
    expect(btn.className).toContain("gap-1");
  });

  it("applies gap-1 to any ActionButton with renderContent, not just download-pdf", () => {
    const action: BibActionDescriptor = {
      key: "custom-action",
      icon: "X",
      label: "Custom",
      onClick: vi.fn(),
      spinner: true,
      renderContent: <span>progress</span>,
    };
    const { container } = render(<ActionButton action={action} />);
    const btn = container.querySelector("button")!;
    expect(btn.className).toContain("gap-1");
  });

  it("does not apply gap-1 to link-pdf button when linking (no renderContent)", () => {
    const h = handlers();
    const state: BibKeyState = { materialization: "shadow", page_id: null };
    render(
      <BibEntryActions
        entry={baseEntry}
        state={state}
        {...h}
        {...defaultLoading}
        linkingKey="smith2024"
      />,
    );
    const btn = screen.getByTestId("link-pdf-btn");
    expect(btn.className).not.toContain("gap-1");
  });

  it("closes overflow menu when actions array changes (e.g., download completes)", () => {
    // Set up manual ResizeObserver
    let roCallback: ResizeObserverCallback | null = null;
    const OriginalRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        roCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    const h = handlers();
    // baseEntry has doi, no file, shadow state => 5 buttons:
    // create-note, enrich, copy-citation, download-pdf, link-pdf
    const state: BibKeyState = { materialization: "shadow", page_id: null };
    const { container, rerender } = render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} />,
    );

    const actionsContainer = container.querySelector("[data-bib-actions]") as HTMLElement;
    expect(actionsContainer).toBeTruthy();

    const BUTTON_WIDTH = 60;
    const TRIG_WIDTH = 28;

    // Make container narrow so overflow trigger appears (only 2 buttons visible)
    (actionsContainer as unknown as { _clientWidth: number })._clientWidth = 160;

    function mockChildWidths() {
      const children = actionsContainer.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i] as HTMLElement;
        if (child.hasAttribute("data-overflow-trigger")) {
          Object.defineProperty(child, "offsetWidth", { value: TRIG_WIDTH, configurable: true });
        } else {
          Object.defineProperty(child, "offsetWidth", { value: BUTTON_WIDTH, configurable: true });
        }
      }
    }

    mockChildWidths();
    act(() => {
      roCallback!(
        [{ target: actionsContainer, contentRect: actionsContainer.getBoundingClientRect(), borderBoxSize: [{ blockSize: 0, inlineSize: 160 }] } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    // Overflow trigger should be present
    const trigger = actionsContainer.querySelector("[data-overflow-trigger]");
    expect(trigger).toBeTruthy();

    // Open the overflow menu
    act(() => {
      fireEvent.click(trigger!);
    });

    // Menu should be visible
    expect(screen.getByTestId("bib-overflow-menu")).toBeInTheDocument();

    // Now simulate download completing: entry gains a file
    const entryWithFile = { ...baseEntry, file: "papers/smith.pdf" };
    // This changes the actions array: "Download PDF" disappears, "Open PDF" + "OCR" appear
    // actions.length changes from 5 to 6
    rerender(
      <BibEntryActions entry={entryWithFile} state={state} {...h} {...defaultLoading} />,
    );

    // After rerender, the useLayoutEffect resets visibleCount to actions.length.
    // Re-trigger measure to make the container narrow again so overflow persists.
    mockChildWidths();
    act(() => {
      roCallback!(
        [{ target: actionsContainer, contentRect: actionsContainer.getBoundingClientRect(), borderBoxSize: [{ blockSize: 0, inlineSize: 160 }] } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    // Overflow trigger should still be present (container is still narrow)
    const triggerAfter = actionsContainer.querySelector("[data-overflow-trigger]");
    expect(triggerAfter).toBeTruthy();

    // But the overflow MENU should be closed (not open) after actions changed
    expect(screen.queryByTestId("bib-overflow-menu")).toBeNull();

    globalThis.ResizeObserver = OriginalRO;
  });

  it("accounts for gap between last visible button and overflow trigger", () => {
    // Set up manual ResizeObserver
    let roCallback: ResizeObserverCallback | null = null;
    const OriginalRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        roCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    const h = handlers();
    const state: BibKeyState = { materialization: "shadow", page_id: null };
    const { container } = render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} />,
    );

    const actionsContainer = container.querySelector("[data-bib-actions]") as HTMLElement;
    expect(actionsContainer).toBeTruthy();

    const BUTTON_WIDTH = 60;
    const TRIG_WIDTH = 28;

    // Container = 220px. Not all 5 buttons fit (324px > 220px), so trigger is needed.
    //
    // Old buggy budget (no gap): 220 - 28 = 192
    //   Button 1: 60 <= 192 (fits, used=60)
    //   Button 2: 60+6+60=126 <= 192 (fits, used=126)
    //   Button 3: 126+6+60=192 <= 192 (fits!, used=192)  <-- 3 visible
    //   But the trigger needs 28+6=34px, and only 220-192=28px remains -- clipped!
    //
    // Correct budget (with gap): 220 - 28 - 6 = 186
    //   Button 1: 60 <= 186 (fits, used=60)
    //   Button 2: 60+6+60=126 <= 186 (fits, used=126)
    //   Button 3: 126+6+60=192 > 186 (does NOT fit)  <-- 2 visible
    //
    // The test asserts visibleCount = 2 (only 2 buttons visible, not 3).
    (actionsContainer as unknown as { _clientWidth: number })._clientWidth = 220;

    function mockChildWidths() {
      const children = actionsContainer.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i] as HTMLElement;
        if (child.hasAttribute("data-overflow-trigger")) {
          Object.defineProperty(child, "offsetWidth", { value: TRIG_WIDTH, configurable: true });
        } else {
          Object.defineProperty(child, "offsetWidth", { value: BUTTON_WIDTH, configurable: true });
        }
      }
    }

    mockChildWidths();
    act(() => {
      roCallback!(
        [{ target: actionsContainer, contentRect: actionsContainer.getBoundingClientRect(), borderBoxSize: [{ blockSize: 0, inlineSize: 220 }] } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    // With correct gap accounting, only 2 buttons should be visible (not 3)
    const visibleButtons = actionsContainer.querySelectorAll("button:not([data-overflow-trigger])");
    expect(visibleButtons.length).toBe(2);
    // Overflow trigger should be present
    expect(actionsContainer.querySelector("[data-overflow-trigger]")).toBeTruthy();

    globalThis.ResizeObserver = OriginalRO;
  });

  it("remeasures after action set grows while overflow was active", () => {
    // Setup: manual ResizeObserver so we control when measure() fires
    let roCallback: ResizeObserverCallback | null = null;
    const OriginalRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        roCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    // Mock offsetWidth at the prototype level so that newly-created elements
    // during React re-renders also return the correct width. This is critical
    // because the correction useLayoutEffect measures elements that were just
    // created during the same React commit cycle.
    const BUTTON_WIDTH = 60;
    const TRIG_WIDTH = 28;
    const originalOffsetWidthDesc = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetWidth",
    );
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        if (this.hasAttribute("data-overflow-trigger")) return TRIG_WIDTH;
        if (this.hasAttribute("data-bib-actions")) return 0; // container itself
        // Any button inside the actions container
        if (this.closest("[data-bib-actions]")) return BUTTON_WIDTH;
        return 0;
      },
    });

    const h = handlers();
    // baseEntry has doi, no file, shadow state => 5 buttons:
    // create-note, enrich, copy-citation, download-pdf, link-pdf
    const state: BibKeyState = { materialization: "shadow", page_id: null };
    const { container, rerender } = render(
      <BibEntryActions entry={baseEntry} state={state} {...h} {...defaultLoading} />,
    );

    const actionsContainer = container.querySelector("[data-bib-actions]") as HTMLElement;
    expect(actionsContainer).toBeTruthy();

    // Container is narrow: 160px. Only 2 buttons fit with trigger.
    // Budget = 160 - 28 (trigger) - 6 (gap) = 126px.
    // Button 1: 60 <= 126 (fits). Button 2: 60+6+60 = 126 <= 126 (fits).
    // Button 3: 126+6+60 = 192 > 126 (doesn't fit). visibleCount = 2.
    (actionsContainer as unknown as { _clientWidth: number })._clientWidth = 160;

    // Trigger initial RO callback to force overflow
    act(() => {
      roCallback!(
        [{ target: actionsContainer, contentRect: actionsContainer.getBoundingClientRect(), borderBoxSize: [{ blockSize: 0, inlineSize: 160 }] } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    // Confirm overflow is active: only 2 non-trigger buttons visible + trigger
    let visibleButtons = actionsContainer.querySelectorAll("button:not([data-overflow-trigger])");
    expect(visibleButtons.length).toBe(2);
    expect(actionsContainer.querySelector("[data-overflow-trigger]")).toBeTruthy();

    // --- Trigger the bug: action set GROWS ---
    // Simulate download completing: entry gains a file.
    // "Download PDF" disappears, but "Open PDF" + "OCR" appear.
    // Actions go from 5 to 6 (create-note, enrich, open-pdf, ocr, copy-citation, link-pdf).
    const entryWithFile = { ...baseEntry, file: "papers/smith.pdf" };
    act(() => {
      rerender(
        <BibEntryActions entry={entryWithFile} state={state} {...h} {...defaultLoading} />,
      );
    });

    // Do NOT manually fire RO callback — the container didn't resize.
    // This is the key: the component must self-heal without a resize event.

    // The invariant: every action must be reachable.
    // With 160px container, budget = 160 - 28 - 6 = 126px.
    // 6 buttons at 60px each cannot all fit. So visibleCount must be < 6.
    visibleButtons = actionsContainer.querySelectorAll("button:not([data-overflow-trigger])");
    const overflowTrigger = actionsContainer.querySelector("[data-overflow-trigger]");

    // If all 6 non-trigger buttons are visible, the bug is present:
    // some buttons are clipped in the overflow:hidden row with no overflow trigger.
    // The correct state: at most 2 visible buttons + overflow trigger.
    expect(visibleButtons.length).toBeLessThan(6);
    expect(overflowTrigger).toBeTruthy();

    // Open the overflow menu and verify remaining actions are accessible there
    act(() => {
      fireEvent.click(overflowTrigger!);
    });
    const menu = screen.getByTestId("bib-overflow-menu");
    const menuButtons = menu.querySelectorAll("button");
    // Total actions reachable = visible buttons + menu buttons = 6
    expect(visibleButtons.length + menuButtons.length).toBe(6);

    // Restore mocks
    if (originalOffsetWidthDesc) {
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidthDesc);
    } else {
      // @ts-expect-error -- restoring prototype
      delete HTMLElement.prototype.offsetWidth;
    }
    globalThis.ResizeObserver = OriginalRO;
  });
});

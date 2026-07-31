import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import CardboxView from "./CardboxView";
import { useCardboxStore } from "../stores/cardbox";
import { useCardboxSelectionStore } from "../stores/cardboxSelection";
import { mockInvoke } from "../test/tauri-mock";
import type { CardboxAnnotation, CardboxLayout } from "../lib/ipc";

interface ProbeProps {
  annotation: CardboxAnnotation;
  expanded: boolean;
  note?: string;
  notePrefill?: string;
  onSelect?: (uuid: string, event: React.MouseEvent) => void;
  onToggleExpand: (uuid: string) => void;
}

const probe = vi.hoisted(() => ({
  renderCounts: new Map<string, number>(),
  latestProps: new Map<string, ProbeProps>(),
}));

// Memoized probe: its render count only increases when CardboxView passes a
// changed prop — exactly what the callback-stability guarantees are about.
// Emits just enough DOM for the focus-highlight path (the data-uuid wrapper
// handleFocusCard queries, the note display element when a note exists) and
// for grid keyboard navigation (a focusable cardbox-card node).
vi.mock("./CardboxCardItem", async () => {
  const React = await import("react");
  const CardboxCardItem = React.memo(function CardboxCardItemProbe(props: ProbeProps) {
    const uuid = props.annotation.uuid;
    probe.renderCounts.set(uuid, (probe.renderCounts.get(uuid) ?? 0) + 1);
    probe.latestProps.set(uuid, props);
    return React.createElement(
      "div",
      { "data-testid": `probe-card-${uuid}`, "data-uuid": uuid },
      React.createElement("div", { "data-testid": "cardbox-card", "data-uuid": uuid, tabIndex: 0 }),
      props.note != null
        ? React.createElement("div", { "data-testid": "card-note-display" })
        : null,
    );
  });
  return { CardboxCardItem };
});

// Same probe surface for cards rendered inside a SortableGroup (group path
// used by the collapsed-group pending-focus case, #972 Cycle 4).
vi.mock("./SortableGroupCard", async () => {
  const React = await import("react");
  const SortableGroupCard = React.memo(function SortableGroupCardProbe(props: ProbeProps) {
    const uuid = props.annotation.uuid;
    probe.renderCounts.set(uuid, (probe.renderCounts.get(uuid) ?? 0) + 1);
    probe.latestProps.set(uuid, props);
    return React.createElement(
      "div",
      { "data-testid": `probe-card-${uuid}`, "data-uuid": uuid },
      props.note != null
        ? React.createElement("div", { "data-testid": "card-note-display" })
        : null,
    );
  });
  return { SortableGroupCard };
});

const A = "uuid-a";
const B = "uuid-b";
const C = "uuid-c";

function makeAnnotation(uuid: string, body: string, charStart = 10): CardboxAnnotation {
  return {
    uuid,
    annotation_type: "note",
    certainty: "neutral",
    body,
    date: "2026-06-15",
    source_page_id: "test.md",
    source_page_title: "Test Document",
    source_line: 5,
    char_start: charStart,
    char_end: charStart + 40,
    scope_kind: "words",
    scope_value: "1",
    original: "source excerpt",
  };
}

// Document order is A (10) < B (20) < C (30).
const fixtures = [
  makeAnnotation(A, "apple pie card", 10),
  makeAnnotation(B, "banana split card", 20),
  makeAnnotation(C, "cherry tart card", 30),
];

const emptyLayout: CardboxLayout = {
  version: 3,
  order: [],
  links: [],
  groups: {},
  pinned: [],
  notes: {},
  colors: {},
};

const initialCardboxState = useCardboxStore.getState();
const initialSelectionState = useCardboxSelectionStore.getState();

beforeEach(() => {
  useCardboxStore.setState(initialCardboxState, true);
  useCardboxSelectionStore.setState(initialSelectionState, true);
  probe.renderCounts.clear();
  probe.latestProps.clear();
  mockInvoke((cmd) => {
    if (cmd === "list_all_annotations") return fixtures;
    if (cmd === "read_cardbox_layout") return emptyLayout;
    return undefined;
  });
});

async function renderView() {
  render(<CardboxView pagePath="test.md" />);
  await screen.findByTestId(`probe-card-${C}`);
  // let the mount-time fetchAnnotations().then(loadLayout) chain settle
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("CardboxView memo effectiveness (#850)", () => {
  it("expand/collapse re-renders only the toggled card", async () => {
    await renderView();
    const before = new Map(probe.renderCounts);

    act(() => {
      useCardboxStore.getState().toggleExpand(A);
    });
    expect(probe.renderCounts.get(A)).toBe(before.get(A)! + 1);
    expect(probe.renderCounts.get(B)).toBe(before.get(B));
    expect(probe.renderCounts.get(C)).toBe(before.get(C));

    act(() => {
      useCardboxStore.getState().toggleExpand(A);
    });
    expect(probe.renderCounts.get(A)).toBe(before.get(A)! + 2);
    expect(probe.renderCounts.get(B)).toBe(before.get(B));
    expect(probe.renderCounts.get(C)).toBe(before.get(C));
  });

  it("search keystroke that keeps all cards visible re-renders no cards", async () => {
    await renderView();
    const before = new Map(probe.renderCounts);

    act(() => {
      useCardboxStore.getState().setSearchQuery("card");
    });

    expect(probe.renderCounts).toEqual(before);
  });

  it("shift-click range select uses the current ordering after a search update", async () => {
    await renderView();

    act(() => {
      useCardboxStore.getState().setSearchQuery("banana");
    });
    expect(screen.queryByTestId(`probe-card-${A}`)).toBeNull();
    expect(screen.getByTestId(`probe-card-${B}`)).toBeInTheDocument();

    // Simulate a pre-existing anchor on a card the search just filtered out.
    act(() => {
      useCardboxSelectionStore.setState({ selectedUuids: new Set([A]), lastSelectedUuid: A });
    });

    const onSelect = probe.latestProps.get(B)?.onSelect;
    expect(onSelect).toBeDefined();
    act(() => {
      onSelect!(B, { shiftKey: true, metaKey: false, ctrlKey: false } as unknown as React.MouseEvent);
    });

    // With the current (filtered) ordering the anchor is absent, so rangeSelect
    // falls back to single-select. A stale ordering [A, B, C] would instead
    // produce {A, B}.
    expect(useCardboxSelectionStore.getState().selectedUuids).toEqual(new Set([B]));
  });
});

describe("collapse-on-scope-change ownership (#972)", () => {
  it("toolbar scope toggle collapses the expanded card", async () => {
    await renderView();
    act(() => {
      useCardboxStore.getState().toggleExpand(A);
    });
    expect(useCardboxStore.getState().expandedUuid).toBe(A);

    await act(async () => {
      screen.getByTestId("scope-workspace").click();
    });

    expect(useCardboxStore.getState().scope).toBe("workspace");
    expect(useCardboxStore.getState().expandedUuid).toBeNull();
  });

  it("programmatic setScope does not collapse the expanded card", async () => {
    await renderView();
    act(() => {
      useCardboxStore.getState().toggleExpand(A);
    });
    expect(useCardboxStore.getState().expandedUuid).toBe(A);

    act(() => {
      useCardboxStore.getState().setScope("workspace");
    });

    expect(useCardboxStore.getState().scope).toBe("workspace");
    expect(useCardboxStore.getState().expandedUuid).toBe(A);
  });
});

describe("pending focus expands collapsed group (#972)", () => {
  it("expands the group and focuses the card inside it", async () => {
    const groupedLayout: CardboxLayout = {
      ...emptyLayout,
      order: ["group:g1", B],
      groups: {
        g1: { name: "Group 1", order: [A], collapsed: true },
      },
    };
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return fixtures;
      if (cmd === "read_cardbox_layout") return groupedLayout;
      if (cmd === "toggle_group_collapsed") return undefined;
      return undefined;
    });

    render(<CardboxView pagePath="test.md" />);
    // Wait for group chrome (card A is hidden while the group is collapsed).
    await screen.findByTestId("cardbox-group");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByTestId(`probe-card-${A}`)).toBeNull();
    expect(useCardboxStore.getState().groups["g1"]?.collapsed).toBe(true);

    act(() => {
      useCardboxStore.getState().setPendingFocusUuid(A);
    });
    // Advance past the 250ms focus timer so any scroll/highlight path settles.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(useCardboxStore.getState().groups["g1"]?.collapsed).toBe(false);
    expect(screen.getByTestId(`probe-card-${A}`)).toBeInTheDocument();
    expect(useCardboxStore.getState().expandedUuid).toBe(A);
    expect(useCardboxStore.getState().pendingFocusUuid).toBeNull();
  });
});

describe("cross-page pending focus widens scope (#972)", () => {
  it("widens to workspace and expands a card from another page", async () => {
    const D = "uuid-d";
    const crossPageFixtures = [
      makeAnnotation(A, "apple pie card"),
      makeAnnotation(B, "banana split card"),
      { ...makeAnnotation(D, "other page card"), source_page_id: "other.md" },
    ];
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return crossPageFixtures;
      if (cmd === "read_cardbox_layout") return emptyLayout;
      return undefined;
    });
    useCardboxStore.setState({
      scope: "document",
      layoutLoaded: true,
    });
    useCardboxStore.getState().setPendingFocusUuid(D);

    render(<CardboxView pagePath="test.md" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(useCardboxStore.getState().scope).toBe("workspace");
    expect(useCardboxStore.getState().expandedUuid).toBe(D);
    expect(screen.getByTestId(`probe-card-${D}`)).toBeInTheDocument();
    expect(useCardboxStore.getState().pendingFocusUuid).toBeNull();
  });
});

describe("pending focus never re-collapses the focused card (#972)", () => {
  it("stays expanded after F2 filter-reset when warm scope is workspace", async () => {
    // Warm store: workspace scope + a type filter that hides card A (note).
    // F2 resetFilters used to flip scope -> document, which fired the [scope]
    // effect's collapseAll and undid the expand. Card must end expanded.
    const mixedFixtures = [
      { ...makeAnnotation(A, "apple pie card"), annotation_type: "note" },
      { ...makeAnnotation(B, "banana llm card"), annotation_type: "llm" },
    ];
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return mixedFixtures;
      if (cmd === "read_cardbox_layout") return emptyLayout;
      return undefined;
    });
    useCardboxStore.setState({
      scope: "workspace",
      activeTypes: new Set(["llm"]),
      layoutLoaded: true,
    });
    useCardboxStore.getState().setPendingFocusUuid(A);

    render(<CardboxView pagePath="test.md" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(useCardboxStore.getState().pendingFocusUuid).toBeNull();
    expect(useCardboxStore.getState().expandedUuid).toBe(A);
    expect(screen.getByTestId(`probe-card-${A}`)).toBeInTheDocument();
  });
});

describe("CardboxView pending focus force-expand (#957)", () => {
  it("pending focus on an already-expanded card keeps it expanded", async () => {
    await renderView();
    act(() => {
      useCardboxStore.getState().toggleExpand(A);
    });
    expect(useCardboxStore.getState().expandedUuid).toBe(A);

    act(() => {
      useCardboxStore.getState().setPendingFocusUuid(A);
    });

    expect(useCardboxStore.getState().expandedUuid).toBe(A);
    expect(useCardboxStore.getState().pendingFocusUuid).toBeNull();
  });

  it("pending focus expands a collapsed card", async () => {
    await renderView();
    expect(useCardboxStore.getState().expandedUuid).toBeNull();

    act(() => {
      useCardboxStore.getState().setPendingFocusUuid(B);
    });

    expect(useCardboxStore.getState().expandedUuid).toBe(B);
    expect(useCardboxStore.getState().pendingFocusUuid).toBeNull();
  });

  it("consuming pending focus resets pendingHighlightNote", async () => {
    await renderView();

    act(() => {
      useCardboxStore.getState().setPendingFocusUuid(A, true);
    });

    expect(useCardboxStore.getState().pendingFocusUuid).toBeNull();
    expect(useCardboxStore.getState().pendingHighlightNote).toBe(false);
  });
});

describe("note highlight waits for layout (#958 finding 1)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cold mount with slow layout IPC still pulses the NOTE section", async () => {
    vi.useFakeTimers();

    // Annotations resolve immediately; the layout read (migrate + read, 2 IPC
    // calls) is deferred to replicate a slow cold-mount cardbox open.
    let resolveLayout!: (layout: CardboxLayout) => void;
    const layoutDeferred = new Promise<CardboxLayout>((r) => {
      resolveLayout = r;
    });
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return fixtures;
      if (cmd === "migrate_cardbox_slip_notes")
        return { migrated: 0, failed: 0, skipped: 0, changed_pages: [], failures: [] };
      if (cmd === "read_cardbox_layout") return layoutDeferred;
      return undefined;
    });

    // The slip-note pill was clicked before the cardbox mounted: pending focus
    // with highlightNote is already in the store, notes are not.
    useCardboxStore.getState().setPendingFocusUuid(A, true);
    render(<CardboxView pagePath="test.md" />);

    // Flush the annotations fetch while the layout promise stays pending, then
    // advance past the 250ms focus delay. On buggy code the pending focus is
    // consumed here, before the NOTE section exists in the DOM.
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // The layout finally arrives, carrying the note body for card A.
    await act(async () => {
      resolveLayout({
        ...emptyLayout,
        notes: { [A]: { body: "n", updated_at: "2026-07-29T00:00:00Z" } },
      });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    const card = screen.getByTestId(`probe-card-${A}`);
    expect(card.classList.contains("card-focus-highlight")).toBe(true);
    const note = card.querySelector('[data-testid="card-note-display"]');
    expect(note).not.toBeNull();
    expect(note!.classList.contains("note-focus-highlight")).toBe(true);
    expect(useCardboxStore.getState().pendingFocusUuid).toBeNull();
    expect(useCardboxStore.getState().pendingHighlightNote).toBe(false);
  });

  it("unmount clears the scheduled 250ms focus timeout", async () => {
    vi.useFakeTimers();
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return fixtures;
      if (cmd === "migrate_cardbox_slip_notes")
        return { migrated: 0, failed: 0, skipped: 0, changed_pages: [], failures: [] };
      if (cmd === "read_cardbox_layout") return emptyLayout;
      return undefined;
    });

    useCardboxStore.getState().setPendingFocusUuid(A, false);
    const { unmount } = render(<CardboxView pagePath="test.md" />);

    // Let fetch + layout settle so the pending focus is consumed and the 250ms
    // scroll/highlight timeout is scheduled.
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(useCardboxStore.getState().pendingFocusUuid).toBeNull();
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("collapse scroll correction (#939)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Stub the scroller/card geometry that jsdom doesn't lay out. cardTop is the
  // card's viewport-space top; the scroller's rect top is 0, so cardTop is also
  // the container-relative offset computeCollapseScrollTop receives.
  function stubGeometry(opts: {
    scrollTop: number;
    clientHeight: number;
    scrollHeight: number;
    cardTop: number;
    cardHeight: number;
  }) {
    const scroller = screen.getByTestId("cardbox-grid");
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
    Object.defineProperties(scroller, {
      scrollTop: { value: opts.scrollTop, configurable: true },
      clientHeight: { value: opts.clientHeight, configurable: true },
      scrollHeight: { value: opts.scrollHeight, configurable: true },
    });
    scroller.getBoundingClientRect = () =>
      ({ top: 0, height: opts.clientHeight } as DOMRect);
    const card = screen.getByTestId(`probe-card-${A}`);
    card.getBoundingClientRect = () =>
      ({ top: opts.cardTop, height: opts.cardHeight } as DOMRect);
    return scrollTo;
  }

  it("collapsing a card that landed above the viewport centers it in the grid", async () => {
    await renderView();
    const onToggleExpand = probe.latestProps.get(A)!.onToggleExpand;
    act(() => {
      onToggleExpand(A); // expand
    });
    expect(useCardboxStore.getState().expandedUuid).toBe(A);

    // After collapse the card sits entirely above the viewport (the reader had
    // scrolled deep into the long expanded body).
    const scrollTo = stubGeometry({
      scrollTop: 1000,
      clientHeight: 600,
      scrollHeight: 2000,
      cardTop: -300,
      cardHeight: 100,
    });

    vi.useFakeTimers();
    act(() => {
      onToggleExpand(A); // collapse
    });
    expect(useCardboxStore.getState().expandedUuid).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled(); // waits out the CSS transition

    act(() => {
      vi.advanceTimersByTime(300);
    });
    // 1000 + (-300) - (600 - 100) / 2
    expect(scrollTo).toHaveBeenCalledWith({ top: 450, behavior: "smooth" });
  });

  it("collapsing a still-visible card does not scroll", async () => {
    await renderView();
    const onToggleExpand = probe.latestProps.get(A)!.onToggleExpand;
    act(() => {
      onToggleExpand(A); // expand
    });

    const scrollTo = stubGeometry({
      scrollTop: 500,
      clientHeight: 600,
      scrollHeight: 2000,
      cardTop: 100,
      cardHeight: 100,
    });

    vi.useFakeTimers();
    act(() => {
      onToggleExpand(A); // collapse
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("expanding a card never schedules a collapse scroll", async () => {
    await renderView();
    const onToggleExpand = probe.latestProps.get(A)!.onToggleExpand;

    // Even out-of-view geometry must not trigger a scroll on expand.
    const scrollTo = stubGeometry({
      scrollTop: 1000,
      clientHeight: 600,
      scrollHeight: 2000,
      cardTop: -300,
      cardHeight: 100,
    });

    vi.useFakeTimers();
    act(() => {
      onToggleExpand(A); // expand (nothing was expanded)
    });
    expect(useCardboxStore.getState().expandedUuid).toBe(A);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("dnd removal (#968)", () => {
  it("renders the grid without a dnd context wrapper or drag overlay", async () => {
    await renderView();
    expect(screen.getByTestId("cardbox-grid")).toBeInTheDocument();
    // dnd-kit's DndContext mounts an accessibility live region and hidden
    // instructions node; sortable wrappers carry aria-roledescription.
    expect(document.querySelector('[id^="DndLiveRegion"]')).toBeNull();
    expect(document.querySelector('[id^="DndDescribedBy"]')).toBeNull();
    expect(document.querySelector('[aria-roledescription="sortable"]')).toBeNull();
  });
});

describe("document ordering (#968)", () => {
  it("renders cards in document order even when the layout supplies a stale manual order", async () => {
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return fixtures;
      if (cmd === "read_cardbox_layout") return { ...emptyLayout, order: [C, B, A] };
      return undefined;
    });
    await renderView();
    const grid = screen.getByTestId("cardbox-grid");
    const rendered = Array.from(
      grid.querySelectorAll('[data-testid^="probe-card-"]'),
    ).map((el) => el.getAttribute("data-uuid"));
    expect(rendered).toEqual([A, B, C]);
  });

  it("arrow navigation indexes match the rendered card order when a group is collapsed", async () => {
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return fixtures;
      if (cmd === "read_cardbox_layout")
        return { ...emptyLayout, groups: { g1: { name: "G", order: [B], collapsed: true } } };
      return undefined;
    });
    await renderView();
    // Rendered focusable cards are A then C; B is hidden in the collapsed group.
    const cards = screen.getAllByTestId("cardbox-card");
    expect(cards.map((el) => el.getAttribute("data-uuid"))).toEqual([A, C]);
    (cards[0] as HTMLElement).focus();
    fireEvent.keyDown(cards[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cards[1]);
    fireEvent.keyDown(cards[1]!, { key: "Enter" });
    expect(useCardboxStore.getState().expandedUuid).toBe(C);
  });

  it("P on a focused card pins the card under the cursor, not a shifted one", async () => {
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return fixtures;
      if (cmd === "read_cardbox_layout")
        return { ...emptyLayout, groups: { g1: { name: "G", order: [B], collapsed: true } } };
      return undefined;
    });
    await renderView();
    const cards = screen.getAllByTestId("cardbox-card");
    (cards[1] as HTMLElement).focus();
    fireEvent.keyDown(cards[1]!, { key: "p" });
    expect(useCardboxStore.getState().pinned).toContain(C);
    expect(useCardboxStore.getState().pinned).not.toContain(B);
  });
});

describe("quote to slip note (#968)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubSelection(anchorNode: Node | null, text: string, collapsed = false) {
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: collapsed,
      anchorNode,
      toString: () => text,
    } as unknown as Selection);
  }

  it("Q with a selection inside a card expands it and stages a blockquote prefill", async () => {
    await renderView();
    stubSelection(screen.getByTestId(`probe-card-${B}`), "quoted");
    act(() => {
      fireEvent.keyDown(document.body, { key: "q" });
    });
    expect(useCardboxStore.getState().expandedUuid).toBe(B);
    expect(useCardboxStore.getState().pendingNotePrefill).toEqual({
      uuid: B,
      text: "> quoted",
    });
  });

  it("does nothing for a collapsed selection", async () => {
    await renderView();
    stubSelection(screen.getByTestId(`probe-card-${B}`), "", true);
    act(() => {
      fireEvent.keyDown(document.body, { key: "q" });
    });
    expect(useCardboxStore.getState().expandedUuid).toBeNull();
    expect(useCardboxStore.getState().pendingNotePrefill).toBeNull();
  });

  it("does nothing for a selection outside the grid", async () => {
    await renderView();
    stubSelection(document.body, "outside text");
    act(() => {
      fireEvent.keyDown(document.body, { key: "q" });
    });
    expect(useCardboxStore.getState().expandedUuid).toBeNull();
    expect(useCardboxStore.getState().pendingNotePrefill).toBeNull();
  });

  it("does not fire while typing in a textarea", async () => {
    await renderView();
    stubSelection(screen.getByTestId(`probe-card-${B}`), "quoted");
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    try {
      textarea.focus();
      act(() => {
        fireEvent.keyDown(textarea, { key: "q" });
      });
      expect(useCardboxStore.getState().pendingNotePrefill).toBeNull();
    } finally {
      textarea.remove();
    }
  });

  it("passes notePrefill only to the target card", async () => {
    await renderView();
    stubSelection(screen.getByTestId(`probe-card-${B}`), "quoted");
    act(() => {
      fireEvent.keyDown(document.body, { key: "q" });
    });
    expect(probe.latestProps.get(B)?.notePrefill).toBe("> quoted");
    // Non-targets keep a stable undefined so memo() is not defeated (#850).
    expect(probe.latestProps.get(A)?.notePrefill).toBeUndefined();
    expect(probe.latestProps.get(C)?.notePrefill).toBeUndefined();
  });
});

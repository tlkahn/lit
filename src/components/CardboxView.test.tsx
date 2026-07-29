import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import CardboxView from "./CardboxView";
import { useCardboxStore } from "../stores/cardbox";
import { useCardboxSelectionStore } from "../stores/cardboxSelection";
import { mockInvoke } from "../test/tauri-mock";
import type { CardboxAnnotation, CardboxLayout } from "../lib/ipc";

interface ProbeProps {
  annotation: CardboxAnnotation;
  expanded: boolean;
  note?: string;
  onSelect?: (uuid: string, event: React.MouseEvent) => void;
}

const probe = vi.hoisted(() => ({
  renderCounts: new Map<string, number>(),
  latestProps: new Map<string, ProbeProps>(),
}));

// Memoized probe: its render count only increases when CardboxView passes a
// changed prop — exactly what the callback-stability guarantees are about.
// Emits just enough DOM for the focus-highlight path: the data-uuid wrapper
// handleFocusCard queries, and the note display element when a note exists.
vi.mock("./SortableCard", async () => {
  const React = await import("react");
  const SortableCard = React.memo(function SortableCardProbe(props: ProbeProps) {
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
  return { SortableCard };
});

const A = "uuid-a";
const B = "uuid-b";
const C = "uuid-c";

function makeAnnotation(uuid: string, body: string): CardboxAnnotation {
  return {
    uuid,
    annotation_type: "note",
    certainty: "neutral",
    body,
    date: "2026-06-15",
    source_page_id: "test.md",
    source_page_title: "Test Document",
    source_line: 5,
    char_start: 10,
    char_end: 50,
    scope_kind: "words",
    scope_value: "1",
    original: "source excerpt",
  };
}

const fixtures = [
  makeAnnotation(A, "apple pie card"),
  makeAnnotation(B, "banana split card"),
  makeAnnotation(C, "cherry tart card"),
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

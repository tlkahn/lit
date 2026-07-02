import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import CardboxView from "./CardboxView";
import { useCardboxStore } from "../stores/cardbox";
import { useCardboxSelectionStore } from "../stores/cardboxSelection";
import { mockInvoke } from "../test/tauri-mock";
import type { CardboxAnnotation, CardboxLayout } from "../lib/ipc";

interface ProbeProps {
  annotation: CardboxAnnotation;
  expanded: boolean;
  onSelect?: (uuid: string, event: React.MouseEvent) => void;
}

const probe = vi.hoisted(() => ({
  renderCounts: new Map<string, number>(),
  latestProps: new Map<string, ProbeProps>(),
}));

// Memoized probe: its render count only increases when CardboxView passes a
// changed prop — exactly what the callback-stability guarantees are about.
vi.mock("./SortableCard", async () => {
  const React = await import("react");
  const SortableCard = React.memo(function SortableCardProbe(props: ProbeProps) {
    const uuid = props.annotation.uuid;
    probe.renderCounts.set(uuid, (probe.renderCounts.get(uuid) ?? 0) + 1);
    probe.latestProps.set(uuid, props);
    return React.createElement("div", { "data-testid": `probe-card-${uuid}` });
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

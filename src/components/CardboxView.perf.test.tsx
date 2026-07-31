import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import CardboxView from "./CardboxView";
import { useCardboxStore } from "../stores/cardbox";
import { useCardboxSelectionStore } from "../stores/cardboxSelection";
import { mockInvoke } from "../test/tauri-mock";
import { generateCardboxAnnotationsCJK } from "../test/fixtures/cardboxCjk";
import type { CardboxAnnotation, CardboxLayout } from "../lib/ipc";

// Perf regression guards for the cardbox fixes in PR #848 (#849/#850), sized
// to a heavily annotated CJK document (仁学-scale and beyond). Render-count
// assertions are the primary guard — they are deterministic and engine-
// independent. The wall-clock assertion is a gross-regression tripwire only:
// jsdom timings are not production milliseconds, so the hard limit is set
// with large headroom and an advisory warns well before it.

const N = 200;
const MOUNT_HARD_LIMIT_MS = 1000;
const MOUNT_ADVISORY_MS = 200;

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
vi.mock("./CardboxCardItem", async () => {
  const React = await import("react");
  const CardboxCardItem = React.memo(function CardboxCardItemProbe(props: ProbeProps) {
    const uuid = props.annotation.uuid;
    probe.renderCounts.set(uuid, (probe.renderCounts.get(uuid) ?? 0) + 1);
    probe.latestProps.set(uuid, props);
    return React.createElement("div", { "data-testid": `probe-card-${uuid}` });
  });
  return { CardboxCardItem };
});

const fixtures = generateCardboxAnnotationsCJK(N);
const LAST = fixtures[N - 1]!.uuid;

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
  render(<CardboxView pagePath="renxue.md" />);
  await screen.findByTestId(`probe-card-${LAST}`);
  // let the mount-time fetchAnnotations().then(loadLayout) chain settle
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function assertOnlyChanged(
  before: Map<string, number>,
  changed: Map<string, number>,
) {
  for (const [uuid, count] of probe.renderCounts) {
    const expected = changed.get(uuid) ?? before.get(uuid);
    expect(count, `render count for ${uuid}`).toBe(expected);
  }
}

describe(`CardboxView perf guards at N=${N} CJK annotations`, () => {
  it("expand/collapse re-renders only the toggled card", async () => {
    await renderView();
    expect(probe.renderCounts.size).toBe(N);
    const before = new Map(probe.renderCounts);
    const target = fixtures[42]!.uuid;

    act(() => {
      useCardboxStore.getState().toggleExpand(target);
    });
    assertOnlyChanged(before, new Map([[target, before.get(target)! + 1]]));

    act(() => {
      useCardboxStore.getState().toggleExpand(target);
    });
    assertOnlyChanged(before, new Map([[target, before.get(target)! + 2]]));
  });

  it("cmd-click select re-renders no probe cards", async () => {
    await renderView();
    const before = new Map(probe.renderCounts);
    const target = fixtures[7]!.uuid;

    const onSelect = probe.latestProps.get(target)?.onSelect;
    expect(onSelect).toBeDefined();
    act(() => {
      onSelect!(target, { shiftKey: false, metaKey: true, ctrlKey: false } as unknown as React.MouseEvent);
    });

    // Selection state is subscribed inside the real CardboxCardItem, not passed
    // down from CardboxView — so with stable callbacks the CardboxView
    // re-render triggered by the selection change must not re-render any
    // memoized card. An unstable handleSelect would re-render all N.
    expect(useCardboxSelectionStore.getState().selectedUuids).toEqual(new Set([target]));
    expect(probe.renderCounts).toEqual(before);
  });

  it("search keystroke that keeps all cards visible re-renders no cards", async () => {
    await renderView();
    const before = new Map(probe.renderCounts);

    act(() => {
      // every body contains 批注, so the visible set is unchanged
      useCardboxStore.getState().setSearchQuery("批注");
    });

    expect(probe.renderCounts).toEqual(before);
  });

  it(`mounts ${N} CJK annotations under ${MOUNT_HARD_LIMIT_MS}ms`, async () => {
    const start = performance.now();
    await renderView();
    const elapsed = performance.now() - start;

    if (elapsed > MOUNT_ADVISORY_MS) {
      console.warn(
        `[perf] CardboxView mount with ${N} annotations took ${elapsed.toFixed(1)}ms (advisory ${MOUNT_ADVISORY_MS}ms)`,
      );
    }
    expect(elapsed).toBeLessThan(MOUNT_HARD_LIMIT_MS);
  });
});

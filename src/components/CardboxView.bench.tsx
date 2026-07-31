import { bench, describe, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { useCardboxStore } from "../stores/cardbox";
import { useCardboxSelectionStore } from "../stores/cardboxSelection";
import { mockInvoke } from "../test/tauri-mock";
import { generateCardboxAnnotationsCJK } from "../test/fixtures/cardboxCjk";
import type { CardboxAnnotation, CardboxLayout } from "../lib/ipc";

// Observation benches for cardbox load + render (post-PR-#848 baseline).
// These isolate the CardboxView orchestration pipeline (fetch → filter/sort
// memos → renderEntries) behind a trivial card probe; the real
// CardboxCardItem→CardboxCard tree is benched separately in
// CardboxViewFull.bench.tsx (vi.mock is per module graph, so probe and full
// render cannot share a file). jsdom numbers are not production milliseconds —
// compare runs against each other, not against the real app (use the lit-perf
// instrumentation for that).

interface ProbeProps {
  annotation: CardboxAnnotation;
}

vi.mock("./CardboxCardItem", async () => {
  const React = await import("react");
  const CardboxCardItem = React.memo(function CardboxCardItemProbe(props: ProbeProps) {
    return React.createElement("div", { "data-testid": `probe-card-${props.annotation.uuid}` });
  });
  return { CardboxCardItem };
});

import CardboxView from "./CardboxView";

const SIZES = [50, 100, 200, 400] as const;
const fixtures = Object.fromEntries(
  SIZES.map((n) => [n, generateCardboxAnnotationsCJK(n)] as const),
) as Record<(typeof SIZES)[number], CardboxAnnotation[]>;

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

// The global beforeEach in src/test/setup.ts resets the invoke mock and
// clears localStorage between iterations, so all state setup must happen
// inside each bench body — never in a one-time hook.
function prepare(n: (typeof SIZES)[number]) {
  useCardboxStore.setState(initialCardboxState, true);
  useCardboxSelectionStore.setState(initialSelectionState, true);
  mockInvoke((cmd) => {
    if (cmd === "list_all_annotations") return fixtures[n];
    if (cmd === "read_cardbox_layout") return emptyLayout;
    return undefined;
  });
}

async function mountAndSettle() {
  const view = render(<CardboxView pagePath="renxue.md" />);
  // let the mount-time fetchAnnotations().then(loadLayout) chain settle
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return view;
}

describe("CardboxView mount (orchestration, probe cards)", () => {
  for (const n of SIZES) {
    bench(`${n} CJK annotations`, async () => {
      prepare(n);
      const { unmount } = await mountAndSettle();
      unmount();
    });
  }
});

describe("re-render: expand one card (probe cards)", () => {
  const n = 200;
  const target = fixtures[n][42]!.uuid;
  bench(`${n} CJK annotations`, async () => {
    prepare(n);
    const { unmount } = await mountAndSettle();
    act(() => {
      useCardboxStore.getState().toggleExpand(target);
    });
    act(() => {
      useCardboxStore.getState().toggleExpand(target);
    });
    unmount();
  });
});

describe("re-render: search keystroke (probe cards)", () => {
  const n = 200;
  bench(`${n} CJK annotations`, async () => {
    prepare(n);
    const { unmount } = await mountAndSettle();
    act(() => {
      useCardboxStore.getState().setSearchQuery("批注");
    });
    act(() => {
      useCardboxStore.getState().setSearchQuery("");
    });
    unmount();
  });
});

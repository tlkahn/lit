import { bench, describe } from "vitest";
import { render, act } from "@testing-library/react";
import CardboxView from "./CardboxView";
import { useCardboxStore } from "../stores/cardbox";
import { useCardboxSelectionStore } from "../stores/cardboxSelection";
import { mockInvoke } from "../test/tauri-mock";
import { generateCardboxAnnotationsCJK } from "../test/fixtures/cardboxCjk";
import type { CardboxAnnotation, CardboxLayout } from "../lib/ipc";

// Full-tree companion to CardboxView.bench.tsx: renders the real
// SortableCard→CardboxCard cards (dnd-kit wiring, shared masonry observer,
// inline-markdown original rendering) with no probe mock. The jsdom
// ResizeObserver stub in src/test/setup.ts only fires once on observe and
// clientHeight is a flat default, so this measures render + observer wiring,
// not real masonry layout — a regression tripwire, not a production number.

const SIZES = [50, 200] as const;
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

// State setup must happen inside each bench body: the global beforeEach in
// src/test/setup.ts resets the invoke mock between iterations.
function prepare(n: (typeof SIZES)[number]) {
  useCardboxStore.setState(initialCardboxState, true);
  useCardboxSelectionStore.setState(initialSelectionState, true);
  mockInvoke((cmd) => {
    if (cmd === "list_all_annotations") return fixtures[n];
    if (cmd === "read_cardbox_layout") return emptyLayout;
    return undefined;
  });
}

describe("CardboxView mount (full card render)", () => {
  for (const n of SIZES) {
    bench(`${n} CJK annotations`, async () => {
      prepare(n);
      const { unmount } = render(<CardboxView pagePath="renxue.md" />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      unmount();
    });
  }
});

describe("re-render: expand one card (full card render)", () => {
  const n = 200;
  const target = fixtures[n][42]!.uuid;
  bench(`${n} CJK annotations`, async () => {
    prepare(n);
    const { unmount } = render(<CardboxView pagePath="renxue.md" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => {
      useCardboxStore.getState().toggleExpand(target);
    });
    act(() => {
      useCardboxStore.getState().toggleExpand(target);
    });
    unmount();
  });
});

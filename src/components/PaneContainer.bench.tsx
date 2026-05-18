import { bench, describe } from "vitest";
import { render, act } from "@testing-library/react";
import { vi } from "vitest";
import {
  usePaneStore,
  findLeaf,
  collectLeaves,
} from "../stores/panes";
import type { PaneNode, PaneLeaf, PaneSplit } from "../stores/panes";

vi.mock("./EditorPane", () => ({
  EditorPane: ({ paneId }: { paneId: string }) => (
    <div data-testid={`editor-pane-${paneId}`} />
  ),
}));

import { PaneContainer } from "./PaneContainer";

// ---------------------------------------------------------------------------
// Fixture: balanced binary tree generator
// ---------------------------------------------------------------------------

function makeBalancedTree(n: number): {
  root: PaneNode;
  leafIds: string[];
} {
  if (n <= 0) throw new Error("n must be >= 1");
  if (n === 1) {
    const leaf: PaneLeaf = { type: "leaf", id: "leaf-0", pagePath: null };
    return { root: leaf, leafIds: ["leaf-0"] };
  }

  let leafCounter = 0;
  let splitCounter = 0;

  function build(count: number, depth: number): PaneNode {
    if (count === 1) {
      const id = `leaf-${leafCounter++}`;
      return { type: "leaf", id, pagePath: null } as PaneLeaf;
    }
    const leftCount = Math.ceil(count / 2);
    const rightCount = count - leftCount;
    const left = build(leftCount, depth + 1);
    const right = build(rightCount, depth + 1);
    const split: PaneSplit = {
      type: "split",
      id: `split-${splitCounter++}`,
      direction: depth % 2 === 0 ? "horizontal" : "vertical",
      children: [left, right],
      sizes: [50, 50],
    };
    return split;
  }

  const root = build(n, 0);
  const leafIds = Array.from({ length: n }, (_, i) => `leaf-${i}`);
  return { root, leafIds };
}

// Pre-compute fixtures at module scope
const SIZES = [1, 4, 8, 16] as const;
const fixtures = Object.fromEntries(
  SIZES.map((n) => [n, makeBalancedTree(n)] as const),
) as Record<(typeof SIZES)[number], ReturnType<typeof makeBalancedTree>>;

// ---------------------------------------------------------------------------
// Pure JS benchmarks
// ---------------------------------------------------------------------------

describe("findLeaf traversal", () => {
  for (const n of SIZES) {
    const { root, leafIds } = fixtures[n];
    const targetId = leafIds[leafIds.length - 1]!;
    bench(`${n} leaves`, () => {
      findLeaf(root, targetId);
    });
  }
});

describe("collectLeaves", () => {
  for (const n of SIZES) {
    const { root } = fixtures[n];
    bench(`${n} leaves`, () => {
      collectLeaves(root);
    });
  }
});

describe("splitPane (store action)", () => {
  for (const n of SIZES) {
    const { root, leafIds } = fixtures[n];
    const targetId = leafIds[leafIds.length - 1]!;
    bench(`${n} leaves`, () => {
      usePaneStore.setState({ root, focusedPaneId: leafIds[0]! });
      usePaneStore.getState().splitPane(targetId, "horizontal");
    });
  }
});

describe("focusPane (store action)", () => {
  for (const n of SIZES) {
    const { root, leafIds } = fixtures[n];
    const targetId = leafIds[leafIds.length - 1]!;
    bench(`${n} leaves`, () => {
      usePaneStore.setState({ root, focusedPaneId: leafIds[0]! });
      usePaneStore.getState().focusPane(targetId);
    });
  }
});

describe("closePane (store action)", () => {
  for (const n of SIZES.filter((s) => s > 1)) {
    const { root, leafIds } = fixtures[n];
    const targetId = leafIds[leafIds.length - 1]!;
    bench(`${n} leaves`, () => {
      usePaneStore.setState({ root, focusedPaneId: leafIds[0]! });
      usePaneStore.getState().closePane(targetId);
    });
  }
});

// ---------------------------------------------------------------------------
// React render benchmarks
// ---------------------------------------------------------------------------

describe("PaneContainer initial render", () => {
  for (const n of SIZES) {
    const { root, leafIds } = fixtures[n];
    bench(`${n} panes`, () => {
      usePaneStore.setState({ root, focusedPaneId: leafIds[0]! });
      const { unmount } = render(<PaneContainer />);
      unmount();
    });
  }
});

describe("re-render: splitPane", () => {
  for (const n of SIZES) {
    const { root, leafIds } = fixtures[n];
    const targetId = leafIds[leafIds.length - 1]!;
    bench(`${n} panes`, () => {
      usePaneStore.setState({ root, focusedPaneId: leafIds[0]! });
      const { unmount } = render(<PaneContainer />);
      act(() => {
        usePaneStore.getState().splitPane(targetId, "horizontal");
      });
      unmount();
    });
  }
});

describe("re-render: focusPane", () => {
  for (const n of SIZES.filter((s) => s > 1)) {
    const { root, leafIds } = fixtures[n];
    const targetId = leafIds[leafIds.length - 1]!;
    bench(`${n} panes`, () => {
      usePaneStore.setState({ root, focusedPaneId: leafIds[0]! });
      const { unmount } = render(<PaneContainer />);
      act(() => {
        usePaneStore.getState().focusPane(targetId);
      });
      unmount();
    });
  }
});

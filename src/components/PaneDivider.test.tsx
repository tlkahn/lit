import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { usePaneStore } from "../stores/panes";
import type { PaneNode } from "../stores/panes";
import { PaneDivider } from "./PaneDivider";

function setupSplit(sizes: number[], direction: "horizontal" | "vertical" = "horizontal") {
  const children: PaneNode[] = sizes.map((_, i) => ({
    type: "leaf" as const,
    id: `pane-${i}`,
    pagePath: null,
  }));
  const root: PaneNode = {
    type: "split",
    id: "split-root",
    direction,
    children,
    sizes,
  };
  usePaneStore.setState({ root, focusedPaneId: "pane-0" });
  return root;
}

function mockParentRect(el: HTMLElement, width: number, height: number) {
  const parent = el.parentElement!;
  parent.getBoundingClientRect = () =>
    ({
      x: 0, y: 0, width, height,
      top: 0, right: width, bottom: height, left: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

let rafCallbacks: Array<() => void> = [];
let rafId = 1;

beforeEach(() => {
  usePaneStore.setState({
    root: { type: "leaf", id: "solo", pagePath: null },
    focusedPaneId: "solo",
  });
  rafCallbacks = [];
  rafId = 1;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    const id = rafId++;
    rafCallbacks.push(cb as () => void);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  return () => {
    cleanup();
    vi.restoreAllMocks();
  };
});

function flushRaf() {
  const cbs = rafCallbacks.splice(0);
  cbs.forEach((cb) => cb());
}

describe("PaneDivider", () => {
  // Cycle 1 — renders with test-id
  it("renders with data-testid", () => {
    setupSplit([50, 50]);
    const { getByTestId } = render(
      <PaneDivider splitPath={[]} direction="horizontal" index={0} />,
    );
    expect(getByTestId("pane-divider")).toBeTruthy();
  });

  // Cycle 2 — cursor depends on direction
  it("has ew-resize cursor for horizontal", () => {
    setupSplit([50, 50]);
    const { getByTestId } = render(
      <PaneDivider splitPath={[]} direction="horizontal" index={0} />,
    );
    expect(getByTestId("pane-divider").style.cursor).toBe("ew-resize");
  });

  it("has ns-resize cursor for vertical", () => {
    setupSplit([50, 50], "vertical");
    const { getByTestId } = render(
      <PaneDivider splitPath={[]} direction="vertical" index={0} />,
    );
    expect(getByTestId("pane-divider").style.cursor).toBe("ns-resize");
  });

  // Cycle 3 — hit area dimensions
  it("has width 4px for horizontal", () => {
    setupSplit([50, 50]);
    const { getByTestId } = render(
      <PaneDivider splitPath={[]} direction="horizontal" index={0} />,
    );
    expect(getByTestId("pane-divider").style.width).toBe("4px");
  });

  it("has height 4px for vertical", () => {
    setupSplit([50, 50], "vertical");
    const { getByTestId } = render(
      <PaneDivider splitPath={[]} direction="vertical" index={0} />,
    );
    expect(getByTestId("pane-divider").style.height).toBe("4px");
  });

  // Cycle 4 — inner visible line
  it("renders inner divider line", () => {
    setupSplit([50, 50]);
    const { getByTestId } = render(
      <PaneDivider splitPath={[]} direction="horizontal" index={0} />,
    );
    expect(getByTestId("pane-divider-line")).toBeTruthy();
  });

  // Cycle 5 — core horizontal drag updates store
  it("horizontal drag updates store sizes", () => {
    setupSplit([50, 50]);
    const { getByTestId } = render(
      <div style={{ width: 1000, height: 500 }}>
        <PaneDivider splitPath={[]} direction="horizontal" index={0} />
      </div>,
    );
    const divider = getByTestId("pane-divider");
    mockParentRect(divider, 1000, 500);

    act(() => {
      fireEvent.mouseDown(divider, { clientX: 500, clientY: 250 });
      fireEvent.mouseMove(document, { clientX: 600, clientY: 250 });
      flushRaf();
    });

    const root = usePaneStore.getState().root;
    expect(root.type).toBe("split");
    if (root.type === "split") {
      expect(root.sizes[0]).toBeCloseTo(60, 0);
      expect(root.sizes[1]).toBeCloseTo(40, 0);
    }
  });

  // Cycle 6 — vertical drag works
  it("vertical drag updates store sizes", () => {
    setupSplit([50, 50], "vertical");
    const { getByTestId } = render(
      <div style={{ width: 500, height: 1000 }}>
        <PaneDivider splitPath={[]} direction="vertical" index={0} />
      </div>,
    );
    const divider = getByTestId("pane-divider");
    mockParentRect(divider, 500, 1000);

    act(() => {
      fireEvent.mouseDown(divider, { clientX: 250, clientY: 500 });
      fireEvent.mouseMove(document, { clientX: 250, clientY: 600 });
      flushRaf();
    });

    const root = usePaneStore.getState().root;
    expect(root.type).toBe("split");
    if (root.type === "split") {
      expect(root.sizes[0]).toBeCloseTo(60, 0);
      expect(root.sizes[1]).toBeCloseTo(40, 0);
    }
  });

  // Cycle 7 — clamping to minimum 10%
  it("clamps left pane to minimum 10%", () => {
    setupSplit([50, 50]);
    const { getByTestId } = render(
      <div style={{ width: 1000, height: 500 }}>
        <PaneDivider splitPath={[]} direction="horizontal" index={0} />
      </div>,
    );
    const divider = getByTestId("pane-divider");
    mockParentRect(divider, 1000, 500);

    act(() => {
      fireEvent.mouseDown(divider, { clientX: 500, clientY: 250 });
      fireEvent.mouseMove(document, { clientX: 50, clientY: 250 });
      flushRaf();
    });

    const root = usePaneStore.getState().root;
    if (root.type === "split") {
      expect(root.sizes[0]).toBeCloseTo(10, 0);
      expect(root.sizes[1]).toBeCloseTo(90, 0);
    }
  });

  it("clamps right pane to minimum 10%", () => {
    setupSplit([50, 50]);
    const { getByTestId } = render(
      <div style={{ width: 1000, height: 500 }}>
        <PaneDivider splitPath={[]} direction="horizontal" index={0} />
      </div>,
    );
    const divider = getByTestId("pane-divider");
    mockParentRect(divider, 1000, 500);

    act(() => {
      fireEvent.mouseDown(divider, { clientX: 500, clientY: 250 });
      fireEvent.mouseMove(document, { clientX: 950, clientY: 250 });
      flushRaf();
    });

    const root = usePaneStore.getState().root;
    if (root.type === "split") {
      expect(root.sizes[0]).toBeCloseTo(90, 0);
      expect(root.sizes[1]).toBeCloseTo(10, 0);
    }
  });

  // Cycle 8 — user-select during drag
  it("sets user-select none during drag, restores on mouseup", () => {
    setupSplit([50, 50]);
    const { getByTestId } = render(
      <div style={{ width: 1000, height: 500 }}>
        <PaneDivider splitPath={[]} direction="horizontal" index={0} />
      </div>,
    );
    const divider = getByTestId("pane-divider");
    mockParentRect(divider, 1000, 500);

    act(() => {
      fireEvent.mouseDown(divider, { clientX: 500, clientY: 250 });
    });
    expect(document.body.style.userSelect).toBe("none");

    act(() => {
      fireEvent.mouseUp(document);
    });
    expect(document.body.style.userSelect).toBe("");
  });

  // Cycle 9 — continuous mousemove updates from originals
  it("multiple mousemoves all compute from original start sizes", () => {
    setupSplit([50, 50]);
    const { getByTestId } = render(
      <div style={{ width: 1000, height: 500 }}>
        <PaneDivider splitPath={[]} direction="horizontal" index={0} />
      </div>,
    );
    const divider = getByTestId("pane-divider");
    mockParentRect(divider, 1000, 500);

    act(() => {
      fireEvent.mouseDown(divider, { clientX: 500, clientY: 250 });
    });

    act(() => {
      fireEvent.mouseMove(document, { clientX: 550, clientY: 250 });
      flushRaf();
    });
    let root = usePaneStore.getState().root;
    if (root.type === "split") {
      expect(root.sizes[0]).toBeCloseTo(55, 0);
    }

    act(() => {
      fireEvent.mouseMove(document, { clientX: 600, clientY: 250 });
      flushRaf();
    });
    root = usePaneStore.getState().root;
    if (root.type === "split") {
      expect(root.sizes[0]).toBeCloseTo(60, 0);
    }

    act(() => {
      fireEvent.mouseMove(document, { clientX: 520, clientY: 250 });
      flushRaf();
    });
    root = usePaneStore.getState().root;
    if (root.type === "split") {
      expect(root.sizes[0]).toBeCloseTo(52, 0);
    }
  });

  // Cycle 10 — rAF throttling
  it("does not update store until rAF fires", () => {
    setupSplit([50, 50]);
    const { getByTestId } = render(
      <div style={{ width: 1000, height: 500 }}>
        <PaneDivider splitPath={[]} direction="horizontal" index={0} />
      </div>,
    );
    const divider = getByTestId("pane-divider");
    mockParentRect(divider, 1000, 500);

    act(() => {
      fireEvent.mouseDown(divider, { clientX: 500, clientY: 250 });
      fireEvent.mouseMove(document, { clientX: 600, clientY: 250 });
      fireEvent.mouseMove(document, { clientX: 650, clientY: 250 });
    });

    // Before rAF: store should still have original sizes
    let root = usePaneStore.getState().root;
    if (root.type === "split") {
      expect(root.sizes[0]).toBe(50);
    }

    // After rAF: should reflect latest position
    act(() => {
      flushRaf();
    });
    root = usePaneStore.getState().root;
    if (root.type === "split") {
      expect(root.sizes[0]).toBeCloseTo(65, 0);
    }
  });

  it("mouseup flushes pending sizes synchronously", () => {
    setupSplit([50, 50]);
    const { getByTestId } = render(
      <div style={{ width: 1000, height: 500 }}>
        <PaneDivider splitPath={[]} direction="horizontal" index={0} />
      </div>,
    );
    const divider = getByTestId("pane-divider");
    mockParentRect(divider, 1000, 500);

    act(() => {
      fireEvent.mouseDown(divider, { clientX: 500, clientY: 250 });
      fireEvent.mouseMove(document, { clientX: 600, clientY: 250 });
      fireEvent.mouseUp(document);
    });

    // Should have flushed without needing rAF
    const root = usePaneStore.getState().root;
    if (root.type === "split") {
      expect(root.sizes[0]).toBeCloseTo(60, 0);
    }
  });

  // Cycle 11 — cleanup on unmount during drag
  it("restores userSelect on unmount during drag", () => {
    setupSplit([50, 50]);
    const { getByTestId, unmount } = render(
      <div style={{ width: 1000, height: 500 }}>
        <PaneDivider splitPath={[]} direction="horizontal" index={0} />
      </div>,
    );
    const divider = getByTestId("pane-divider");
    mockParentRect(divider, 1000, 500);

    act(() => {
      fireEvent.mouseDown(divider, { clientX: 500, clientY: 250 });
    });
    expect(document.body.style.userSelect).toBe("none");

    unmount();
    expect(document.body.style.userSelect).toBe("");
  });

  // Cycle 12 — double-click equalizes sizes
  it("double-click equalizes 2 panes", () => {
    setupSplit([30, 70]);
    const { getByTestId } = render(
      <PaneDivider splitPath={[]} direction="horizontal" index={0} />,
    );
    const divider = getByTestId("pane-divider");

    act(() => {
      fireEvent.doubleClick(divider);
    });

    const root = usePaneStore.getState().root;
    if (root.type === "split") {
      expect(root.sizes[0]).toBeCloseTo(50, 0);
      expect(root.sizes[1]).toBeCloseTo(50, 0);
    }
  });

  it("double-click equalizes 3 panes", () => {
    setupSplit([20, 50, 30]);
    const { getByTestId } = render(
      <PaneDivider splitPath={[]} direction="horizontal" index={0} />,
    );
    const divider = getByTestId("pane-divider");

    act(() => {
      fireEvent.doubleClick(divider);
    });

    const root = usePaneStore.getState().root;
    if (root.type === "split") {
      const expected = 100 / 3;
      expect(root.sizes[0]).toBeCloseTo(expected, 1);
      expect(root.sizes[1]).toBeCloseTo(expected, 1);
      expect(root.sizes[2]).toBeCloseTo(expected, 1);
    }
  });

  // 3-pane drag leaves uninvolved pane unchanged
  it("3-pane drag only changes adjacent panes", () => {
    setupSplit([30, 40, 30]);
    const { getByTestId } = render(
      <div style={{ width: 1000, height: 500 }}>
        <PaneDivider splitPath={[]} direction="horizontal" index={0} />
      </div>,
    );
    const divider = getByTestId("pane-divider");
    mockParentRect(divider, 1000, 500);

    act(() => {
      fireEvent.mouseDown(divider, { clientX: 300, clientY: 250 });
      fireEvent.mouseMove(document, { clientX: 400, clientY: 250 });
      flushRaf();
    });

    const root = usePaneStore.getState().root;
    if (root.type === "split") {
      expect(root.sizes[0]).toBeCloseTo(40, 0);
      expect(root.sizes[1]).toBeCloseTo(30, 0);
      expect(root.sizes[2]).toBe(30);
    }
  });

  // Cycle 13 — invalid splitPath is no-op
  it("drag on invalid splitPath does not crash", () => {
    // root is a leaf, splitPath won't find a split
    usePaneStore.setState({
      root: { type: "leaf", id: "solo", pagePath: null },
      focusedPaneId: "solo",
    });
    const { getByTestId } = render(
      <div style={{ width: 1000, height: 500 }}>
        <PaneDivider splitPath={[99]} direction="horizontal" index={0} />
      </div>,
    );
    const divider = getByTestId("pane-divider");
    mockParentRect(divider, 1000, 500);

    act(() => {
      fireEvent.mouseDown(divider, { clientX: 500, clientY: 250 });
      fireEvent.mouseMove(document, { clientX: 600, clientY: 250 });
      flushRaf();
      fireEvent.mouseUp(document);
    });

    // No crash, root unchanged
    const root = usePaneStore.getState().root;
    expect(root.type).toBe("leaf");
  });

  it("double-click on invalid splitPath is no-op", () => {
    usePaneStore.setState({
      root: { type: "leaf", id: "solo", pagePath: null },
      focusedPaneId: "solo",
    });
    const { getByTestId } = render(
      <PaneDivider splitPath={[99]} direction="horizontal" index={0} />,
    );

    act(() => {
      fireEvent.doubleClick(getByTestId("pane-divider"));
    });

    const root = usePaneStore.getState().root;
    expect(root.type).toBe("leaf");
  });

  // Cycle 21 — accessibility
  it("has role=separator", () => {
    setupSplit([50, 50]);
    const { getByTestId } = render(
      <PaneDivider splitPath={[]} direction="horizontal" index={0} />,
    );
    expect(getByTestId("pane-divider").getAttribute("role")).toBe("separator");
  });

  it("has aria-orientation matching direction", () => {
    setupSplit([50, 50]);
    const { getByTestId } = render(
      <PaneDivider splitPath={[]} direction="horizontal" index={0} />,
    );
    expect(getByTestId("pane-divider").getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("has aria-orientation vertical for vertical direction", () => {
    setupSplit([50, 50], "vertical");
    const { getByTestId } = render(
      <PaneDivider splitPath={[]} direction="vertical" index={0} />,
    );
    expect(getByTestId("pane-divider").getAttribute("aria-orientation")).toBe("vertical");
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { createRef } from "react";
import { ResizeHandle, getResizeConfig } from "./ResizeHandle";
import { MIN_PANEL_HEIGHT, MIN_PANEL_WIDTH } from "../stores/bottomPanel";

function mockParentBoundingRect(panel: HTMLDivElement, height: number, width = 800) {
  const parent = panel.parentElement!;
  parent.getBoundingClientRect = () =>
    ({
      x: 0, y: 0, width, height,
      top: 0, right: width, bottom: height, left: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

function renderHandle(props: Partial<React.ComponentProps<typeof ResizeHandle>> = {}) {
  const panelRef = createRef<HTMLDivElement>();
  const contentRef = createRef<HTMLDivElement>();
  const onResizeEnd = vi.fn();
  const wrapper = document.createElement("div");
  document.body.appendChild(wrapper);

  const { unmount } = render(
    <div ref={panelRef} style={{ width: "320px", height: "200px", transition: "height 150ms ease-out" }}>
      <div ref={contentRef} style={{ width: "320px", height: "200px" }}>
        <ResizeHandle
          direction={props.direction ?? "bottom"}
          currentSize={props.currentSize ?? 200}
          enabled={props.enabled ?? true}
          minSize={props.minSize}
          panelRef={panelRef}
          contentRef={contentRef}
          onResizeEnd={props.onResizeEnd ?? onResizeEnd}
        />
      </div>
    </div>,
    { container: wrapper },
  );

  return { panelRef, contentRef, onResizeEnd, unmount, wrapper };
}

describe("getResizeConfig", () => {
  it("returns correct config for bottom", () => {
    const c = getResizeConfig("bottom");
    expect(c.axis).toBe("y");
    expect(c.cursor).toBe("ns-resize");
    expect(c.deltaSign).toBe(-1);
    expect(c.maxRatio).toBe(0.6);
    expect(c.minSize).toBe(MIN_PANEL_HEIGHT);
    expect(c.dimension).toBe("height");
    expect(c.transition).toContain("height");
  });

  it("returns correct config for right", () => {
    const c = getResizeConfig("right");
    expect(c.axis).toBe("x");
    expect(c.cursor).toBe("ew-resize");
    expect(c.deltaSign).toBe(-1);
    expect(c.maxRatio).toBe(0.5);
    expect(c.minSize).toBe(MIN_PANEL_WIDTH);
    expect(c.dimension).toBe("width");
    expect(c.transition).toContain("width");
  });

  it("returns correct config for left", () => {
    const c = getResizeConfig("left");
    expect(c.axis).toBe("x");
    expect(c.cursor).toBe("ew-resize");
    expect(c.deltaSign).toBe(1);
    expect(c.maxRatio).toBe(0.5);
    expect(c.minSize).toBe(MIN_PANEL_WIDTH);
    expect(c.dimension).toBe("width");
    expect(c.transition).toContain("width");
  });
});

describe("ResizeHandle", () => {
  beforeEach(() => {
    document.body.style.userSelect = "";
  });

  describe("rendering", () => {
    it("renders with data-testid", () => {
      renderHandle();
      expect(screen.getByTestId("resize-handle")).toBeInTheDocument();
    });

    it("bottom handle has ns-resize cursor and height 4px", () => {
      renderHandle({ direction: "bottom" });
      const handle = screen.getByTestId("resize-handle");
      expect(handle.style.cursor).toBe("ns-resize");
      expect(handle.style.height).toBe("4px");
    });

    it("right handle has ew-resize cursor, width 4px, positioned left", () => {
      renderHandle({ direction: "right" });
      const handle = screen.getByTestId("resize-handle");
      expect(handle.style.cursor).toBe("ew-resize");
      expect(handle.style.width).toBe("4px");
      expect(handle.style.left).toBe("0px");
    });

    it("left handle has ew-resize cursor, width 4px, positioned right", () => {
      renderHandle({ direction: "left" });
      const handle = screen.getByTestId("resize-handle");
      expect(handle.style.cursor).toBe("ew-resize");
      expect(handle.style.width).toBe("4px");
      expect(handle.style.right).toBe("0px");
    });
  });

  describe("drag bottom", () => {
    it("drag up increases height", () => {
      const { panelRef } = renderHandle({ direction: "bottom", currentSize: 200 });
      mockParentBoundingRect(panelRef.current!, 1000);

      const handle = screen.getByTestId("resize-handle");
      act(() => {
        fireEvent.mouseDown(handle, { clientY: 500 });
        fireEvent.mouseMove(document, { clientY: 400 });
      });
      expect(panelRef.current!.style.height).toBe("300px");
    });

    it("clamps to min size", () => {
      const { panelRef } = renderHandle({ direction: "bottom", currentSize: 200 });
      mockParentBoundingRect(panelRef.current!, 1000);

      const handle = screen.getByTestId("resize-handle");
      act(() => {
        fireEvent.mouseDown(handle, { clientY: 500 });
        fireEvent.mouseMove(document, { clientY: 700 });
      });
      expect(panelRef.current!.style.height).toBe(`${MIN_PANEL_HEIGHT}px`);
    });

    it("clamps to max ratio of parent", () => {
      const { panelRef } = renderHandle({ direction: "bottom", currentSize: 200 });
      mockParentBoundingRect(panelRef.current!, 500);

      const handle = screen.getByTestId("resize-handle");
      act(() => {
        fireEvent.mouseDown(handle, { clientY: 500 });
        fireEvent.mouseMove(document, { clientY: 100 });
      });
      expect(panelRef.current!.style.height).toBe("300px");
    });
  });

  describe("drag right", () => {
    it("drag left increases width", () => {
      const { panelRef } = renderHandle({ direction: "right", currentSize: 320 });
      mockParentBoundingRect(panelRef.current!, 600, 1000);

      const handle = screen.getByTestId("resize-handle");
      act(() => {
        fireEvent.mouseDown(handle, { clientX: 500 });
        fireEvent.mouseMove(document, { clientX: 400 });
      });
      expect(panelRef.current!.style.width).toBe("420px");
    });
  });

  describe("drag left", () => {
    it("drag right increases width", () => {
      const { panelRef } = renderHandle({ direction: "left", currentSize: 320 });
      mockParentBoundingRect(panelRef.current!, 600, 1000);

      const handle = screen.getByTestId("resize-handle");
      act(() => {
        fireEvent.mouseDown(handle, { clientX: 320 });
        fireEvent.mouseMove(document, { clientX: 420 });
      });
      expect(panelRef.current!.style.width).toBe("420px");
    });

    it("minSize prop overrides default min for left direction", () => {
      const { panelRef } = renderHandle({ direction: "left", currentSize: 320, minSize: 180 });
      mockParentBoundingRect(panelRef.current!, 600, 1000);

      const handle = screen.getByTestId("resize-handle");
      act(() => {
        fireEvent.mouseDown(handle, { clientX: 320 });
        fireEvent.mouseMove(document, { clientX: 100 });
      });
      // 320 - 220 = 100, clamped to minSize 180
      expect(panelRef.current!.style.width).toBe("180px");
    });

    it("default min (MIN_PANEL_WIDTH) still applies when minSize omitted", () => {
      const { panelRef } = renderHandle({ direction: "left", currentSize: 320 });
      mockParentBoundingRect(panelRef.current!, 600, 1000);

      const handle = screen.getByTestId("resize-handle");
      act(() => {
        fireEvent.mouseDown(handle, { clientX: 320 });
        fireEvent.mouseMove(document, { clientX: 100 });
      });
      // 320 - 220 = 100, clamped to MIN_PANEL_WIDTH (200)
      expect(panelRef.current!.style.width).toBe(`${MIN_PANEL_WIDTH}px`);
    });
  });

  describe("user-select and transition during drag", () => {
    it("sets body user-select to none during drag and clears after", () => {
      const { panelRef } = renderHandle({ direction: "bottom", currentSize: 200 });
      mockParentBoundingRect(panelRef.current!, 1000);

      const handle = screen.getByTestId("resize-handle");
      act(() => {
        fireEvent.mouseDown(handle, { clientY: 500 });
      });
      expect(document.body.style.userSelect).toBe("none");

      act(() => {
        fireEvent.mouseUp(document);
      });
      expect(document.body.style.userSelect).toBe("");
    });

    it("disables transition during drag and restores after", () => {
      const { panelRef } = renderHandle({ direction: "bottom", currentSize: 200 });
      mockParentBoundingRect(panelRef.current!, 1000);

      const handle = screen.getByTestId("resize-handle");
      act(() => {
        fireEvent.mouseDown(handle, { clientY: 500 });
      });
      expect(panelRef.current!.style.transition).toBe("none");

      act(() => {
        fireEvent.mouseUp(document);
      });
      expect(panelRef.current!.style.transition).toBe("height 150ms ease-out");
    });
  });

  describe("enabled guard", () => {
    it("no-op when enabled=false", () => {
      const onResizeEnd = vi.fn();
      const { panelRef } = renderHandle({ direction: "bottom", currentSize: 200, enabled: false, onResizeEnd });
      mockParentBoundingRect(panelRef.current!, 1000);

      const handle = screen.getByTestId("resize-handle");
      act(() => {
        fireEvent.mouseDown(handle, { clientY: 500 });
        fireEvent.mouseMove(document, { clientY: 400 });
        fireEvent.mouseUp(document);
      });
      expect(onResizeEnd).not.toHaveBeenCalled();
      expect(document.body.style.userSelect).toBe("");
    });
  });

  describe("onResizeEnd", () => {
    it("called with final size on mouseup", () => {
      const onResizeEnd = vi.fn();
      const { panelRef } = renderHandle({ direction: "bottom", currentSize: 200, onResizeEnd });
      mockParentBoundingRect(panelRef.current!, 1000);

      const handle = screen.getByTestId("resize-handle");
      act(() => {
        fireEvent.mouseDown(handle, { clientY: 500 });
        fireEvent.mouseMove(document, { clientY: 400 });
        fireEvent.mouseUp(document);
      });
      expect(onResizeEnd).toHaveBeenCalledWith(300);
    });
  });

  describe("unmount safety", () => {
    it("unmount during drag does not throw", () => {
      const { panelRef, unmount } = renderHandle({ direction: "bottom", currentSize: 200 });
      mockParentBoundingRect(panelRef.current!, 1000);

      const handle = screen.getByTestId("resize-handle");
      act(() => {
        fireEvent.mouseDown(handle, { clientY: 500 });
        fireEvent.mouseMove(document, { clientY: 400 });
      });
      expect(() => unmount()).not.toThrow();
    });
  });
});

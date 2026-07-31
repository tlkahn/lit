import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCardboxKeyboard } from "./useCardboxKeyboard";
import type { MutableRefObject } from "react";

type HookOptions = Parameters<typeof useCardboxKeyboard>[0];

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function setup(overrides: Partial<HookOptions> = {}, cardCount = 3) {
  const options: HookOptions = {
    onExpand: vi.fn(),
    onNavigate: vi.fn(),
    onOpenLinkPicker: vi.fn(),
    onTogglePin: vi.fn(),
    onToggleNote: vi.fn(),
    onToggleScope: vi.fn(),
    onShowConnections: vi.fn(),
    onExitConnections: vi.fn(),
    onShowShortcuts: vi.fn(),
    onSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    expandedUuid: null,
    connectionsActive: false,
    itemCount: cardCount,
    ...overrides,
  };
  const rendered = renderHook(() => useCardboxKeyboard(options));
  cleanups.push(() => rendered.unmount());

  // Wire a real grid with focusable cards behind the hook's ref.
  const grid = document.createElement("div");
  document.body.appendChild(grid);
  cleanups.push(() => grid.remove());
  const cards: HTMLElement[] = [];
  for (let i = 0; i < cardCount; i++) {
    const card = document.createElement("div");
    card.setAttribute("data-testid", "cardbox-card");
    card.tabIndex = 0;
    grid.appendChild(card);
    cards.push(card);
  }
  (rendered.result.current.gridRef as MutableRefObject<HTMLDivElement | null>).current =
    grid as HTMLDivElement;

  return { ...rendered, options, grid, cards };
}

function dispatchGlobalKey(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { ...init, cancelable: true, bubbles: true });
  window.dispatchEvent(event);
  return event;
}

function gridKey(
  result: { current: ReturnType<typeof useCardboxKeyboard> },
  init: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean },
) {
  const event = {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
  result.current.handleKeyDown(event);
  return event;
}

describe("useCardboxKeyboard", () => {
  it("does not preventDefault or handle ⌘C", () => {
    // The native copy shortcut must reach the browser untouched (#968).
    const { options } = setup();
    const event = dispatchGlobalKey({ key: "c", metaKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(options.onSelectAll).not.toHaveBeenCalled();
    expect(options.onShowConnections).not.toHaveBeenCalled();
    expect(options.onClearSelection).not.toHaveBeenCalled();
  });

  it("does not treat ⌘C as the connections shortcut on the grid layer", () => {
    const { result, options, cards } = setup({ expandedUuid: "u1" });
    cards[0]!.focus();
    const event = gridKey(result, { key: "c", metaKey: true });
    expect(options.onShowConnections).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("⌘A selects all and prevents the browser default", () => {
    // No onExpandTextSelection callback wired: old behavior is unchanged.
    const { options } = setup();
    const event = dispatchGlobalKey({ key: "a", metaKey: true });
    expect(options.onSelectAll).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("⌘A defers to text-selection expansion when the callback consumes it", () => {
    const onExpandTextSelection = vi.fn(() => true);
    const { options } = setup({ onExpandTextSelection });
    const event = dispatchGlobalKey({ key: "a", metaKey: true });
    expect(onExpandTextSelection).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(options.onSelectAll).not.toHaveBeenCalled();
  });

  it("⌘A falls back to select-all-cards when no quotable selection exists", () => {
    const onExpandTextSelection = vi.fn(() => false);
    const { options } = setup({ onExpandTextSelection });
    const event = dispatchGlobalKey({ key: "a", metaKey: true });
    expect(onExpandTextSelection).toHaveBeenCalledTimes(1);
    expect(options.onSelectAll).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Escape clears the selection", () => {
    const { options } = setup();
    dispatchGlobalKey({ key: "Escape" });
    expect(options.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("S toggles the scope", () => {
    const { options } = setup();
    const event = dispatchGlobalKey({ key: "s" });
    expect(options.onToggleScope).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("bails out when focus is in a textarea", () => {
    const { options } = setup();
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    cleanups.push(() => textarea.remove());
    textarea.focus();
    dispatchGlobalKey({ key: "s" });
    expect(options.onToggleScope).not.toHaveBeenCalled();
  });

  it("ArrowRight from the last card wraps focus to the first", () => {
    const { result, cards } = setup();
    cards[2]!.focus();
    gridKey(result, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cards[0]);
  });

  describe("collapsing-group exit animation (#968)", () => {
    it("skips cards inside a data-collapsed container for nav and index resolution", () => {
      // A collapsing group's cards linger in the DOM during the 150ms exit
      // animation while orderedUuids (itemCount) already excludes them.
      const { result, options, grid, cards } = setup({}, 2);
      const collapsing = document.createElement("div");
      collapsing.setAttribute("data-collapsed", "true");
      const ghost = document.createElement("div");
      ghost.setAttribute("data-testid", "cardbox-card");
      ghost.tabIndex = 0;
      collapsing.appendChild(ghost);
      // Insert the collapsing group between the two live cards.
      grid.insertBefore(collapsing, cards[1]!);

      cards[0]!.focus();
      gridKey(result, { key: "ArrowRight" });
      expect(document.activeElement).toBe(cards[1]);

      gridKey(result, { key: "Enter" });
      expect(options.onExpand).toHaveBeenCalledWith(1);
    });
  });

  describe("Q quote shortcut (#968)", () => {
    it("prevents default when the callback reports it consumed the key", () => {
      const onQuoteSelection = vi.fn(() => true);
      setup({ onQuoteSelection });
      const event = dispatchGlobalKey({ key: "q" });
      expect(onQuoteSelection).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it("leaves the default alone when nothing was quotable", () => {
      const onQuoteSelection = vi.fn(() => false);
      setup({ onQuoteSelection });
      const event = dispatchGlobalKey({ key: "q" });
      expect(onQuoteSelection).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(false);
    });

    it("ignores Q with a modifier held", () => {
      const onQuoteSelection = vi.fn(() => true);
      setup({ onQuoteSelection });
      const event = dispatchGlobalKey({ key: "q", metaKey: true });
      expect(onQuoteSelection).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });
  });
});

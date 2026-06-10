import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEmptyPaneFocus } from "./useEmptyPaneFocus";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("useEmptyPaneFocus", () => {
  it("returns a ref object", () => {
    const { result } = renderHook(() => useEmptyPaneFocus(false, null));
    expect(result.current).toHaveProperty("current");
    expect(result.current.current).toBeNull();
  });

  it("focuses the container when isFocused=true and pagePath=null", () => {
    const div = document.createElement("div");
    div.tabIndex = -1;
    document.body.appendChild(div);

    // Start unfocused so we can wire the ref before the focusing effect fires
    const { result, rerender } = renderHook(
      ({ isFocused, pagePath }) => useEmptyPaneFocus(isFocused, pagePath),
      { initialProps: { isFocused: false, pagePath: null as string | null } },
    );

    // Wire up the ref, then transition to focused to trigger the effect
    result.current.current = div;
    rerender({ isFocused: true, pagePath: null });

    expect(document.activeElement).toBe(div);
  });

  it("does not focus when isFocused=false", () => {
    const div = document.createElement("div");
    div.tabIndex = -1;
    document.body.appendChild(div);

    const { result, rerender } = renderHook(
      ({ isFocused, pagePath }) => useEmptyPaneFocus(isFocused, pagePath),
      { initialProps: { isFocused: false, pagePath: null as string | null } },
    );

    result.current.current = div;
    rerender({ isFocused: false, pagePath: null });

    expect(document.activeElement).not.toBe(div);
  });

  it("does not focus when pagePath is set", () => {
    const div = document.createElement("div");
    div.tabIndex = -1;
    document.body.appendChild(div);

    const { result, rerender } = renderHook(
      ({ isFocused, pagePath }) => useEmptyPaneFocus(isFocused, pagePath),
      { initialProps: { isFocused: true, pagePath: "foo.md" as string | null } },
    );

    result.current.current = div;
    rerender({ isFocused: true, pagePath: "foo.md" });

    expect(document.activeElement).not.toBe(div);
  });

  it("focuses when pagePath transitions from non-null to null while focused", () => {
    const div = document.createElement("div");
    div.tabIndex = -1;
    document.body.appendChild(div);

    const { result, rerender } = renderHook(
      ({ isFocused, pagePath }) => useEmptyPaneFocus(isFocused, pagePath),
      { initialProps: { isFocused: true, pagePath: "foo.md" as string | null } },
    );

    result.current.current = div;
    rerender({ isFocused: true, pagePath: null });

    expect(document.activeElement).toBe(div);
  });
});

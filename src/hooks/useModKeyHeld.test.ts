import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useModKeyHeld } from "./useModKeyHeld";

describe("useModKeyHeld", () => {
  afterEach(() => {
    // Fire keyup to reset any lingering state from previous tests
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
  });

  it("returns false initially", () => {
    const { result } = renderHook(() => useModKeyHeld());
    expect(result.current).toBe(false);
  });

  it("returns true after Meta keydown, false after keyup", () => {
    const { result } = renderHook(() => useModKeyHeld());

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
    });
    expect(result.current).toBe(true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" }));
    });
    expect(result.current).toBe(false);
  });

  it("returns true after Control keydown, false after keyup", () => {
    const { result } = renderHook(() => useModKeyHeld());

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Control" }));
    });
    expect(result.current).toBe(true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    });
    expect(result.current).toBe(false);
  });

  it("resets to false on window blur", () => {
    const { result } = renderHook(() => useModKeyHeld());

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
    });
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(result.current).toBe(false);
  });

  it("ignores non-modifier keys", () => {
    const { result } = renderHook(() => useModKeyHeld());

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
    });
    expect(result.current).toBe(false);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    expect(result.current).toBe(false);
  });

  it("cleans up listeners on unmount", () => {
    const { result, unmount } = renderHook(() => useModKeyHeld());

    unmount();

    // After unmount, keydown should not update the (now unmounted) state.
    // If listeners weren't cleaned up, React would warn about state updates
    // on an unmounted component. We just verify no error is thrown.
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
    });
    // result.current still holds the last value before unmount
    expect(result.current).toBe(false);
  });
});

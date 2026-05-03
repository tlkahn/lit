import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useModalLock } from "./useModalLock";
import { useModalLockStore } from "../stores/modalLock";

describe("useModalLock", () => {
  beforeEach(() => {
    useModalLockStore.setState({ openCount: 0, locked: false });
  });

  it("does not increment when isOpen is false", () => {
    renderHook(() => useModalLock(false));
    expect(useModalLockStore.getState().openCount).toBe(0);
  });

  it("increments when isOpen is true", () => {
    renderHook(() => useModalLock(true));
    expect(useModalLockStore.getState().openCount).toBe(1);
    expect(useModalLockStore.getState().locked).toBe(true);
  });

  it("decrements on unmount", () => {
    const { unmount } = renderHook(() => useModalLock(true));
    expect(useModalLockStore.getState().openCount).toBe(1);
    unmount();
    expect(useModalLockStore.getState().openCount).toBe(0);
    expect(useModalLockStore.getState().locked).toBe(false);
  });

  it("decrements when isOpen transitions true to false", () => {
    const { rerender } = renderHook(
      ({ isOpen }) => useModalLock(isOpen),
      { initialProps: { isOpen: true } },
    );
    expect(useModalLockStore.getState().openCount).toBe(1);
    rerender({ isOpen: false });
    expect(useModalLockStore.getState().openCount).toBe(0);
    expect(useModalLockStore.getState().locked).toBe(false);
  });

  it("two hooks open gives openCount 2; one closes gives openCount 1, still locked", () => {
    const hook1 = renderHook(() => useModalLock(true));
    const hook2 = renderHook(() => useModalLock(true));
    expect(useModalLockStore.getState().openCount).toBe(2);
    expect(useModalLockStore.getState().locked).toBe(true);

    hook1.unmount();
    expect(useModalLockStore.getState().openCount).toBe(1);
    expect(useModalLockStore.getState().locked).toBe(true);

    hook2.unmount();
    expect(useModalLockStore.getState().openCount).toBe(0);
    expect(useModalLockStore.getState().locked).toBe(false);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { useModalLockStore } from "./modalLock";

describe("modalLock store", () => {
  beforeEach(() => {
    useModalLockStore.setState({ openCount: 0, locked: false });
  });

  it("starts with openCount 0 and locked false", () => {
    const state = useModalLockStore.getState();
    expect(state.openCount).toBe(0);
    expect(state.locked).toBe(false);
  });

  it("increment sets openCount 1 and locked true", () => {
    useModalLockStore.getState().increment();
    const state = useModalLockStore.getState();
    expect(state.openCount).toBe(1);
    expect(state.locked).toBe(true);
  });

  it("two increments set openCount 2", () => {
    useModalLockStore.getState().increment();
    useModalLockStore.getState().increment();
    expect(useModalLockStore.getState().openCount).toBe(2);
    expect(useModalLockStore.getState().locked).toBe(true);
  });

  it("decrement from 1 sets locked false", () => {
    useModalLockStore.getState().increment();
    useModalLockStore.getState().decrement();
    const state = useModalLockStore.getState();
    expect(state.openCount).toBe(0);
    expect(state.locked).toBe(false);
  });

  it("decrement from 2 stays locked", () => {
    useModalLockStore.getState().increment();
    useModalLockStore.getState().increment();
    useModalLockStore.getState().decrement();
    const state = useModalLockStore.getState();
    expect(state.openCount).toBe(1);
    expect(state.locked).toBe(true);
  });

  it("decrement from 0 does not underflow", () => {
    useModalLockStore.getState().decrement();
    const state = useModalLockStore.getState();
    expect(state.openCount).toBe(0);
    expect(state.locked).toBe(false);
  });

  it("increment then decrement round-trips", () => {
    useModalLockStore.getState().increment();
    expect(useModalLockStore.getState().locked).toBe(true);
    useModalLockStore.getState().decrement();
    expect(useModalLockStore.getState().locked).toBe(false);
  });
});

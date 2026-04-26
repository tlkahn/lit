import { describe, it, expect, beforeEach } from "vitest";
import { useFocusModeStore } from "./focusMode";

describe("focusMode store", () => {
  beforeEach(() => {
    useFocusModeStore.setState({ active: false });
  });

  it("starts inactive", () => {
    expect(useFocusModeStore.getState().active).toBe(false);
  });

  it("toggleFocusMode flips the boolean", () => {
    useFocusModeStore.getState().toggleFocusMode();
    expect(useFocusModeStore.getState().active).toBe(true);
  });

  it("toggles back to inactive", () => {
    useFocusModeStore.getState().toggleFocusMode();
    useFocusModeStore.getState().toggleFocusMode();
    expect(useFocusModeStore.getState().active).toBe(false);
  });
});

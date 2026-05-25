import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useStatusMessageStore } from "./statusMessage";

describe("useStatusMessageStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStatusMessageStore.setState({ message: null, variant: "success" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("message is null initially", () => {
    expect(useStatusMessageStore.getState().message).toBeNull();
  });

  it("show() sets the message", () => {
    useStatusMessageStore.getState().show("hello");
    expect(useStatusMessageStore.getState().message).toBe("hello");
  });

  it("show() defaults variant to success", () => {
    useStatusMessageStore.getState().show("hello");
    expect(useStatusMessageStore.getState().variant).toBe("success");
  });

  it("show() with error variant sets variant to error", () => {
    useStatusMessageStore.getState().show("oops", "error");
    expect(useStatusMessageStore.getState().variant).toBe("error");
  });

  it("message auto-clears after default duration", () => {
    useStatusMessageStore.getState().show("temp");
    expect(useStatusMessageStore.getState().message).toBe("temp");
    vi.advanceTimersByTime(4000);
    expect(useStatusMessageStore.getState().message).toBeNull();
  });

  it("message auto-clears after custom duration", () => {
    useStatusMessageStore.getState().show("temp", "success", 1000);
    vi.advanceTimersByTime(999);
    expect(useStatusMessageStore.getState().message).toBe("temp");
    vi.advanceTimersByTime(1);
    expect(useStatusMessageStore.getState().message).toBeNull();
  });

  it("calling show() again resets the timer", () => {
    useStatusMessageStore.getState().show("first", "success", 2000);
    vi.advanceTimersByTime(1500);
    useStatusMessageStore.getState().show("second", "success", 2000);
    vi.advanceTimersByTime(1500);
    expect(useStatusMessageStore.getState().message).toBe("second");
    vi.advanceTimersByTime(500);
    expect(useStatusMessageStore.getState().message).toBeNull();
  });
});

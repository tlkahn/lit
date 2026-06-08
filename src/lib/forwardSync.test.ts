import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  dispatchForwardSync,
  DEBOUNCE_MS,
  ECHO_GUARD_MS,
  _resetForTesting,
} from "./forwardSync";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import type { PageMarker } from "./pageMarkers";

const markers: PageMarker[] = [
  { page: 1, charOffset: 0 },
  { page: 2, charOffset: 50 },
  { page: 3, charOffset: 120 },
];

describe("dispatchForwardSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetForTesting();
    usePanePdfLinkStore.setState({
      links: new Map(),
      lastSyncedPage: null,
      syncEnabled: true,
    });
  });

  afterEach(() => {
    _resetForTesting();
    usePanePdfLinkStore.setState({
      links: new Map(),
      lastSyncedPage: null,
      syncEnabled: true,
    });
    vi.useRealTimers();
  });

  describe("sync toggle", () => {
    it("does not call goToPage when syncEnabled is false", () => {
      const goToPage = vi.fn();
      usePanePdfLinkStore.setState({ syncEnabled: false });
      dispatchForwardSync({ read: () => ({ offset: 60, markers }), goToPage });
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(goToPage).not.toHaveBeenCalled();
    });

    it("calls goToPage when syncEnabled is true (regression)", () => {
      const goToPage = vi.fn();
      usePanePdfLinkStore.setState({ syncEnabled: true });
      dispatchForwardSync({ read: () => ({ offset: 60, markers }), goToPage });
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(goToPage).toHaveBeenCalledTimes(1);
    });

    it("honors a toggle that happens mid-debounce (checked at fire time)", () => {
      const goToPage = vi.fn();
      usePanePdfLinkStore.setState({ syncEnabled: true });
      dispatchForwardSync({ read: () => ({ offset: 60, markers }), goToPage });
      // Disable during the debounce window, before the trailing-edge fire.
      usePanePdfLinkStore.setState({ syncEnabled: false });
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(goToPage).not.toHaveBeenCalled();
    });
  });

  it("does not call goToPage synchronously, then calls once after DEBOUNCE_MS", () => {
    const goToPage = vi.fn();
    dispatchForwardSync({ read: () => ({ offset: 60, markers }), goToPage });
    expect(goToPage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(goToPage).toHaveBeenCalledTimes(1);
    expect(goToPage).toHaveBeenCalledWith(1);
  });

  it("debounces rapid calls, firing once with the LAST offset", () => {
    const goToPage = vi.fn();
    dispatchForwardSync({ read: () => ({ offset: 0, markers }), goToPage });
    dispatchForwardSync({ read: () => ({ offset: 60, markers }), goToPage });
    dispatchForwardSync({ read: () => ({ offset: 200, markers }), goToPage });

    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(goToPage).toHaveBeenCalledTimes(1);
    expect(goToPage).toHaveBeenCalledWith(2);
  });

  it("does not fire before the full debounce window elapses", () => {
    const goToPage = vi.fn();
    dispatchForwardSync({ read: () => ({ offset: 60, markers }), goToPage });

    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    expect(goToPage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(goToPage).toHaveBeenCalledTimes(1);
  });

  describe("fire-time reads (no stale capture)", () => {
    it("uses the value the reader returns at FIRE time, not at schedule time", () => {
      const goToPage = vi.fn();
      // Simulate a document edit during the debounce window that moves the
      // cursor offset WITHOUT firing a new onSelectionChange/dispatchForwardSync.
      let current: { offset: number; markers: PageMarker[] } = { offset: 0, markers };
      dispatchForwardSync({ read: () => current, goToPage });
      // Mutate after scheduling, before the trailing-edge fire.
      current = { offset: 200, markers };
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(goToPage).toHaveBeenCalledTimes(1);
      // offset 200 resolves to page index 2; offset 0 would have been 0.
      expect(goToPage).toHaveBeenCalledWith(2);
    });

    it("does not call goToPage when read() returns null (view gone at fire time)", () => {
      const goToPage = vi.fn();
      dispatchForwardSync({ read: () => null, goToPage });
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(goToPage).not.toHaveBeenCalled();
    });
  });

  describe("logging hygiene", () => {
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    it("does not log when scheduling or on the fire path", () => {
      const goToPage = vi.fn();
      dispatchForwardSync({ read: () => ({ offset: 60, markers }), goToPage });
      // Schedule log would fire synchronously at call time.
      expect(logSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(goToPage).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("does not log on the syncEnabled=false bail", () => {
      const goToPage = vi.fn();
      usePanePdfLinkStore.setState({ syncEnabled: false });
      dispatchForwardSync({ read: () => ({ offset: 60, markers }), goToPage });
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("does not log on the read()=null bail", () => {
      const goToPage = vi.fn();
      dispatchForwardSync({ read: () => null, goToPage });
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("does not log on the echo-guard SUPPRESSED path", () => {
      const goToPage = vi.fn();
      usePanePdfLinkStore.getState().setLastSyncedPage(1);
      dispatchForwardSync({ read: () => ({ offset: 60, markers }), goToPage });
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(goToPage).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("echo guard", () => {
    it("ECHO_GUARD_MS comfortably exceeds DEBOUNCE_MS", () => {
      expect(ECHO_GUARD_MS).toBeGreaterThan(DEBOUNCE_MS);
    });

    it("suppresses goToPage when the resolved page matches a recent reverse sync", () => {
      const goToPage = vi.fn();
      // Reverse sync just scrolled the editor to page index 1.
      usePanePdfLinkStore.getState().setLastSyncedPage(1);
      // The echo selection change resolves to the same page index 1.
      dispatchForwardSync({ read: () => ({ offset: 60, markers }), goToPage });
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(goToPage).not.toHaveBeenCalled();
    });

    it("does NOT suppress when the resolved page differs from lastSyncedPage", () => {
      const goToPage = vi.fn();
      usePanePdfLinkStore.getState().setLastSyncedPage(0);
      // offset 60 resolves to page index 1, not the synced 0.
      dispatchForwardSync({ read: () => ({ offset: 60, markers }), goToPage });
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(goToPage).toHaveBeenCalledTimes(1);
      expect(goToPage).toHaveBeenCalledWith(1);
    });

    it("re-syncs the same page once the echo window has elapsed", () => {
      const goToPage = vi.fn();
      usePanePdfLinkStore.getState().setLastSyncedPage(1);
      // Advance past the echo window before the cursor settles.
      vi.advanceTimersByTime(ECHO_GUARD_MS + 1);
      dispatchForwardSync({ read: () => ({ offset: 60, markers }), goToPage });
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(goToPage).toHaveBeenCalledTimes(1);
      expect(goToPage).toHaveBeenCalledWith(1);
    });
  });
});

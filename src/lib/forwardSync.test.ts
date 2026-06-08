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
      dispatchForwardSync({ offset: 60, markers, goToPage });
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(goToPage).not.toHaveBeenCalled();
    });

    it("calls goToPage when syncEnabled is true (regression)", () => {
      const goToPage = vi.fn();
      usePanePdfLinkStore.setState({ syncEnabled: true });
      dispatchForwardSync({ offset: 60, markers, goToPage });
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(goToPage).toHaveBeenCalledTimes(1);
    });

    it("honors a toggle that happens mid-debounce (checked at fire time)", () => {
      const goToPage = vi.fn();
      usePanePdfLinkStore.setState({ syncEnabled: true });
      dispatchForwardSync({ offset: 60, markers, goToPage });
      // Disable during the debounce window, before the trailing-edge fire.
      usePanePdfLinkStore.setState({ syncEnabled: false });
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(goToPage).not.toHaveBeenCalled();
    });
  });

  it("does not call goToPage synchronously, then calls once after DEBOUNCE_MS", () => {
    const goToPage = vi.fn();
    dispatchForwardSync({ offset: 60, markers, goToPage });
    expect(goToPage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(goToPage).toHaveBeenCalledTimes(1);
    expect(goToPage).toHaveBeenCalledWith(1);
  });

  it("debounces rapid calls, firing once with the LAST offset", () => {
    const goToPage = vi.fn();
    dispatchForwardSync({ offset: 0, markers, goToPage });
    dispatchForwardSync({ offset: 60, markers, goToPage });
    dispatchForwardSync({ offset: 200, markers, goToPage });

    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(goToPage).toHaveBeenCalledTimes(1);
    expect(goToPage).toHaveBeenCalledWith(2);
  });

  it("does not fire before the full debounce window elapses", () => {
    const goToPage = vi.fn();
    dispatchForwardSync({ offset: 60, markers, goToPage });

    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    expect(goToPage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(goToPage).toHaveBeenCalledTimes(1);
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
      dispatchForwardSync({ offset: 60, markers, goToPage });
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(goToPage).not.toHaveBeenCalled();
    });

    it("does NOT suppress when the resolved page differs from lastSyncedPage", () => {
      const goToPage = vi.fn();
      usePanePdfLinkStore.getState().setLastSyncedPage(0);
      // offset 60 resolves to page index 1, not the synced 0.
      dispatchForwardSync({ offset: 60, markers, goToPage });
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(goToPage).toHaveBeenCalledTimes(1);
      expect(goToPage).toHaveBeenCalledWith(1);
    });

    it("re-syncs the same page once the echo window has elapsed", () => {
      const goToPage = vi.fn();
      usePanePdfLinkStore.getState().setLastSyncedPage(1);
      // Advance past the echo window before the cursor settles.
      vi.advanceTimersByTime(ECHO_GUARD_MS + 1);
      dispatchForwardSync({ offset: 60, markers, goToPage });
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(goToPage).toHaveBeenCalledTimes(1);
      expect(goToPage).toHaveBeenCalledWith(1);
    });
  });
});

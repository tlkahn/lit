import { describe, it, expect, beforeEach } from "vitest";
import {
  useBottomPanelStore,
  defaultTabMeta,
  DEFAULT_PANEL_HEIGHT,
  DEFAULT_PANEL_WIDTH,
  WIDTH_STORAGE_KEY,
  STORAGE_KEY,
  MIN_PANEL_HEIGHT,
  MIN_PANEL_WIDTH,
} from "./bottomPanel";

describe("bottomPanel setUnfolded", () => {
  beforeEach(() => {
    useBottomPanelStore.setState({
      activeTab: "linked",
      unfolded: false,
      tabMeta: defaultTabMeta(),
    });
  });

  it("sets hasOpenedUnlinked when unfolding with unlinked tab active", () => {
    useBottomPanelStore.setState({ activeTab: "unlinked" });
    useBottomPanelStore.getState().setUnfolded(true);
    expect(useBottomPanelStore.getState().tabMeta.unlinked.hasOpened).toBe(true);
  });

  it("sets hasOpenedAnnotations when unfolding with annotations tab active", () => {
    useBottomPanelStore.setState({ activeTab: "annotations" });
    useBottomPanelStore.getState().setUnfolded(true);
    expect(useBottomPanelStore.getState().tabMeta.annotations.hasOpened).toBe(true);
  });

  it("sets hasOpenedOutgoing when unfolding with outgoing tab active", () => {
    useBottomPanelStore.setState({ activeTab: "outgoing" });
    useBottomPanelStore.getState().setUnfolded(true);
    expect(useBottomPanelStore.getState().tabMeta.outgoing.hasOpened).toBe(true);
  });

  it("does not set hasOpened flags when folding", () => {
    useBottomPanelStore.setState({ activeTab: "unlinked", unfolded: true });
    useBottomPanelStore.getState().setUnfolded(false);
    expect(useBottomPanelStore.getState().tabMeta.unlinked.hasOpened).toBe(false);
    expect(useBottomPanelStore.getState().unfolded).toBe(false);
  });
});

describe("bottomPanel handleTabClick outgoing", () => {
  beforeEach(() => {
    useBottomPanelStore.setState({
      activeTab: "linked",
      unfolded: false,
      tabMeta: defaultTabMeta(),
    });
  });

  it("sets hasOpenedOutgoing to true", () => {
    useBottomPanelStore.getState().handleTabClick("outgoing");
    expect(useBottomPanelStore.getState().tabMeta.outgoing.hasOpened).toBe(true);
  });
});

describe("bottomPanel setTabCount outgoing", () => {
  beforeEach(() => {
    useBottomPanelStore.setState({
      activeTab: "linked",
      unfolded: false,
      tabMeta: defaultTabMeta(),
    });
  });

  it("updates count", () => {
    useBottomPanelStore.getState().setTabCount("outgoing", 5);
    expect(useBottomPanelStore.getState().tabMeta.outgoing.count).toBe(5);
  });

  it("clears count with null", () => {
    useBottomPanelStore.getState().setTabCount("outgoing", 3);
    useBottomPanelStore.getState().setTabCount("outgoing", null);
    expect(useBottomPanelStore.getState().tabMeta.outgoing.count).toBeNull();
  });
});

describe("bottomPanel resetForPage", () => {
  beforeEach(() => {
    useBottomPanelStore.setState({
      activeTab: "linked",
      unfolded: false,
      tabMeta: defaultTabMeta(),
    });
  });

  it("resets counts and annotations", () => {
    useBottomPanelStore.getState().setTabCount("annotations", 3);
    useBottomPanelStore.getState().markOpened("annotations");
    useBottomPanelStore.getState().resetForPage();
    const s = useBottomPanelStore.getState();
    expect(s.tabMeta.annotations.count).toBe(0);
    expect(s.tabMeta.annotations.hasOpened).toBe(false);
  });

  it("resets outgoingCount to null", () => {
    useBottomPanelStore.getState().setTabCount("outgoing", 7);
    useBottomPanelStore.getState().resetForPage();
    expect(useBottomPanelStore.getState().tabMeta.outgoing.count).toBeNull();
  });

  it("resets hasOpenedOutgoing to false when not active+unfolded", () => {
    useBottomPanelStore.setState({ activeTab: "linked", unfolded: true });
    useBottomPanelStore.getState().markOpened("outgoing");
    useBottomPanelStore.getState().resetForPage();
    expect(useBottomPanelStore.getState().tabMeta.outgoing.hasOpened).toBe(false);
  });

  it("preserves hasOpenedOutgoing when outgoing is active and unfolded", () => {
    useBottomPanelStore.setState({ activeTab: "outgoing", unfolded: true });
    useBottomPanelStore.getState().resetForPage();
    expect(useBottomPanelStore.getState().tabMeta.outgoing.hasOpened).toBe(true);
  });
});

describe("bottomPanel panelWidth", () => {
  beforeEach(() => {
    localStorage.removeItem(WIDTH_STORAGE_KEY);
    useBottomPanelStore.setState({ panelWidth: DEFAULT_PANEL_WIDTH });
  });

  it("defaults panelWidth to DEFAULT_PANEL_WIDTH", () => {
    expect(useBottomPanelStore.getState().panelWidth).toBe(DEFAULT_PANEL_WIDTH);
  });

  it("setPanelWidth updates state", () => {
    useBottomPanelStore.getState().setPanelWidth(400);
    expect(useBottomPanelStore.getState().panelWidth).toBe(400);
  });

  it("setPanelWidth persists to localStorage", () => {
    useBottomPanelStore.getState().setPanelWidth(450);
    expect(localStorage.getItem(WIDTH_STORAGE_KEY)).toBe("450");
  });

  it("setPanelWidth clamps sub-minimum values to MIN_PANEL_WIDTH", () => {
    useBottomPanelStore.getState().setPanelWidth(50);
    expect(useBottomPanelStore.getState().panelWidth).toBe(MIN_PANEL_WIDTH);
    expect(localStorage.getItem(WIDTH_STORAGE_KEY)).toBe(String(MIN_PANEL_WIDTH));
  });

  it("setPanelWidth persistence round-trip: set, read store, confirm localStorage", () => {
    const targetWidth = 500;
    // 1. Set the width
    useBottomPanelStore.getState().setPanelWidth(targetWidth);
    // 2. Read back from the store
    expect(useBottomPanelStore.getState().panelWidth).toBe(targetWidth);
    // 3. Confirm localStorage was updated
    expect(localStorage.getItem(WIDTH_STORAGE_KEY)).toBe(String(targetWidth));
  });
});

describe("bottomPanel handleTabClick annotations", () => {
  beforeEach(() => {
    useBottomPanelStore.setState({
      activeTab: "linked",
      unfolded: false,
      tabMeta: defaultTabMeta(),
    });
  });

  it("opens and activates annotations tab", () => {
    useBottomPanelStore.getState().handleTabClick("annotations");
    const s = useBottomPanelStore.getState();
    expect(s.activeTab).toBe("annotations");
    expect(s.unfolded).toBe(true);
    expect(s.tabMeta.annotations.hasOpened).toBe(true);
  });

  it("folds panel when annotations is already active and unfolded", () => {
    useBottomPanelStore.setState({
      activeTab: "annotations",
      unfolded: true,
      tabMeta: { ...defaultTabMeta(), annotations: { count: 2, hasOpened: true } },
    });
    useBottomPanelStore.getState().handleTabClick("annotations");
    const s = useBottomPanelStore.getState();
    expect(s.unfolded).toBe(false);
  });

  it("switches to annotations from another tab without folding", () => {
    useBottomPanelStore.setState({
      activeTab: "linked",
      unfolded: true,
      tabMeta: defaultTabMeta(),
    });
    useBottomPanelStore.getState().handleTabClick("annotations");
    const s = useBottomPanelStore.getState();
    expect(s.activeTab).toBe("annotations");
    expect(s.unfolded).toBe(true);
  });
});


describe("bottomPanel hasFoldAllThread", () => {
  beforeEach(() => {
    useBottomPanelStore.setState({
      activeTab: "linked",
      unfolded: false,
      tabMeta: defaultTabMeta(),
      hasFoldAllThread: false,
    });
  });

  it("defaults to false", () => {
    expect(useBottomPanelStore.getState().hasFoldAllThread).toBe(false);
  });

  it("setHasFoldAllThread updates state", () => {
    useBottomPanelStore.getState().setHasFoldAllThread(true);
    expect(useBottomPanelStore.getState().hasFoldAllThread).toBe(true);
    useBottomPanelStore.getState().setHasFoldAllThread(false);
    expect(useBottomPanelStore.getState().hasFoldAllThread).toBe(false);
  });

  it("resetForPage clears it to false", () => {
    useBottomPanelStore.getState().setHasFoldAllThread(true);
    useBottomPanelStore.getState().resetForPage();
    expect(useBottomPanelStore.getState().hasFoldAllThread).toBe(false);
  });
});

describe("bottomPanel panelHeight clamping", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    useBottomPanelStore.setState({ panelHeight: DEFAULT_PANEL_HEIGHT });
  });

  it("setPanelHeight clamps sub-minimum values to MIN_PANEL_HEIGHT", () => {
    useBottomPanelStore.getState().setPanelHeight(30);
    expect(useBottomPanelStore.getState().panelHeight).toBe(MIN_PANEL_HEIGHT);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(String(MIN_PANEL_HEIGHT));
  });

  it("setPanelHeight allows values at or above the minimum", () => {
    useBottomPanelStore.getState().setPanelHeight(MIN_PANEL_HEIGHT);
    expect(useBottomPanelStore.getState().panelHeight).toBe(MIN_PANEL_HEIGHT);

    useBottomPanelStore.getState().setPanelHeight(500);
    expect(useBottomPanelStore.getState().panelHeight).toBe(500);
  });
});

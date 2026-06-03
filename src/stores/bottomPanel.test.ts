import { describe, it, expect, beforeEach } from "vitest";
import {
  useBottomPanelStore,
  DEFAULT_PANEL_HEIGHT,
  DEFAULT_PANEL_WIDTH,
  WIDTH_STORAGE_KEY,
  STORAGE_KEY,
  MIN_PANEL_HEIGHT,
  MIN_PANEL_WIDTH,
} from "./bottomPanel";
import { useLlmResponseStore } from "./llmResponse";

describe("bottomPanel setUnfolded", () => {
  beforeEach(() => {
    useBottomPanelStore.setState({
      activeTab: "linked",
      unfolded: false,
      linkedCount: null,
      unlinkedCount: null,
      annotationCount: 0,
      hasOpenedUnlinked: false,
      hasOpenedAnnotations: false,
      hasOpenedLlm: false,
      outgoingCount: null,
      hasOpenedOutgoing: false,
    });
  });

  it("sets hasOpenedLlm when unfolding with llm-response tab active", () => {
    useBottomPanelStore.setState({ activeTab: "llm-response", hasOpenedLlm: false });
    useBottomPanelStore.getState().setUnfolded(true);
    expect(useBottomPanelStore.getState().hasOpenedLlm).toBe(true);
    expect(useBottomPanelStore.getState().unfolded).toBe(true);
  });

  it("sets hasOpenedUnlinked when unfolding with unlinked tab active", () => {
    useBottomPanelStore.setState({ activeTab: "unlinked", hasOpenedUnlinked: false });
    useBottomPanelStore.getState().setUnfolded(true);
    expect(useBottomPanelStore.getState().hasOpenedUnlinked).toBe(true);
  });

  it("sets hasOpenedAnnotations when unfolding with annotations tab active", () => {
    useBottomPanelStore.setState({ activeTab: "annotations", hasOpenedAnnotations: false });
    useBottomPanelStore.getState().setUnfolded(true);
    expect(useBottomPanelStore.getState().hasOpenedAnnotations).toBe(true);
  });

  it("sets hasOpenedOutgoing when unfolding with outgoing tab active", () => {
    useBottomPanelStore.setState({ activeTab: "outgoing", hasOpenedOutgoing: false });
    useBottomPanelStore.getState().setUnfolded(true);
    expect(useBottomPanelStore.getState().hasOpenedOutgoing).toBe(true);
  });

  it("does not set hasOpened flags when folding", () => {
    useBottomPanelStore.setState({ activeTab: "llm-response", unfolded: true, hasOpenedLlm: false });
    useBottomPanelStore.getState().setUnfolded(false);
    expect(useBottomPanelStore.getState().hasOpenedLlm).toBe(false);
    expect(useBottomPanelStore.getState().unfolded).toBe(false);
  });
});

describe("bottomPanel handleTabClick outgoing", () => {
  beforeEach(() => {
    useBottomPanelStore.setState({
      activeTab: "linked",
      unfolded: false,
      linkedCount: null,
      unlinkedCount: null,
      annotationCount: 0,
      hasOpenedUnlinked: false,
      hasOpenedAnnotations: false,
      hasOpenedLlm: false,
      outgoingCount: null,
      hasOpenedOutgoing: false,
    });
  });

  it("sets hasOpenedOutgoing to true", () => {
    useBottomPanelStore.getState().handleTabClick("outgoing");
    expect(useBottomPanelStore.getState().hasOpenedOutgoing).toBe(true);
  });
});

describe("bottomPanel setOutgoingCount", () => {
  beforeEach(() => {
    useBottomPanelStore.setState({
      activeTab: "linked",
      unfolded: false,
      linkedCount: null,
      unlinkedCount: null,
      annotationCount: 0,
      hasOpenedUnlinked: false,
      hasOpenedAnnotations: false,
      hasOpenedLlm: false,
      outgoingCount: null,
      hasOpenedOutgoing: false,
    });
  });

  it("updates count", () => {
    useBottomPanelStore.getState().setOutgoingCount(5);
    expect(useBottomPanelStore.getState().outgoingCount).toBe(5);
  });

  it("clears count with null", () => {
    useBottomPanelStore.setState({ outgoingCount: 3 });
    useBottomPanelStore.getState().setOutgoingCount(null);
    expect(useBottomPanelStore.getState().outgoingCount).toBeNull();
  });
});

describe("bottomPanel resetForPage", () => {
  beforeEach(() => {
    useBottomPanelStore.setState({
      activeTab: "linked",
      unfolded: false,
      linkedCount: null,
      unlinkedCount: null,
      annotationCount: 0,
      hasOpenedUnlinked: false,
      hasOpenedAnnotations: false,
      hasOpenedLlm: false,
      outgoingCount: null,
      hasOpenedOutgoing: false,
    });
    useLlmResponseStore.getState().reset();
  });

  it("preserves hasOpenedLlm when llmResponse status is streaming", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useBottomPanelStore.setState({ hasOpenedLlm: true });
    useBottomPanelStore.getState().resetForPage();
    expect(useBottomPanelStore.getState().hasOpenedLlm).toBe(true);
  });

  it("preserves hasOpenedLlm when llmResponse status is done", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().finishStream();
    useBottomPanelStore.setState({ hasOpenedLlm: true });
    useBottomPanelStore.getState().resetForPage();
    expect(useBottomPanelStore.getState().hasOpenedLlm).toBe(true);
  });

  it("preserves hasOpenedLlm when llmResponse status is error", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().setError("fail");
    useBottomPanelStore.setState({ hasOpenedLlm: true });
    useBottomPanelStore.getState().resetForPage();
    expect(useBottomPanelStore.getState().hasOpenedLlm).toBe(true);
  });

  it("resets hasOpenedLlm when llmResponse status is idle", () => {
    useBottomPanelStore.setState({ hasOpenedLlm: true });
    useBottomPanelStore.getState().resetForPage();
    expect(useBottomPanelStore.getState().hasOpenedLlm).toBe(false);
  });

  it("still resets counts and annotations when LLM is streaming", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useBottomPanelStore.setState({
      hasOpenedLlm: true,
      annotationCount: 3,
      hasOpenedAnnotations: true,
    });
    useBottomPanelStore.getState().resetForPage();
    const s = useBottomPanelStore.getState();
    expect(s.annotationCount).toBe(0);
    expect(s.hasOpenedAnnotations).toBe(false);
    expect(s.hasOpenedLlm).toBe(true);
  });

  it("resets outgoingCount to null", () => {
    useBottomPanelStore.setState({ outgoingCount: 7 });
    useBottomPanelStore.getState().resetForPage();
    expect(useBottomPanelStore.getState().outgoingCount).toBeNull();
  });

  it("resets hasOpenedOutgoing to false when not active+unfolded", () => {
    useBottomPanelStore.setState({ activeTab: "linked", unfolded: true, hasOpenedOutgoing: true });
    useBottomPanelStore.getState().resetForPage();
    expect(useBottomPanelStore.getState().hasOpenedOutgoing).toBe(false);
  });

  it("preserves hasOpenedOutgoing when outgoing is active and unfolded", () => {
    useBottomPanelStore.setState({ activeTab: "outgoing", unfolded: true, hasOpenedOutgoing: false });
    useBottomPanelStore.getState().resetForPage();
    expect(useBottomPanelStore.getState().hasOpenedOutgoing).toBe(true);
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

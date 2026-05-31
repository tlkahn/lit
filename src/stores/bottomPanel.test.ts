import { describe, it, expect, beforeEach } from "vitest";
import { useBottomPanelStore, WIDTH_STORAGE_KEY } from "./bottomPanel";
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

  it("does not set hasOpened flags when folding", () => {
    useBottomPanelStore.setState({ activeTab: "llm-response", unfolded: true, hasOpenedLlm: false });
    useBottomPanelStore.getState().setUnfolded(false);
    expect(useBottomPanelStore.getState().hasOpenedLlm).toBe(false);
    expect(useBottomPanelStore.getState().unfolded).toBe(false);
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
});

describe("bottomPanel panelWidth", () => {
  beforeEach(() => {
    localStorage.removeItem(WIDTH_STORAGE_KEY);
    useBottomPanelStore.setState({ panelWidth: 320 });
  });

  it("defaults panelWidth to 320", () => {
    expect(useBottomPanelStore.getState().panelWidth).toBe(320);
  });

  it("setPanelWidth updates state", () => {
    useBottomPanelStore.getState().setPanelWidth(400);
    expect(useBottomPanelStore.getState().panelWidth).toBe(400);
  });

  it("setPanelWidth persists to localStorage", () => {
    useBottomPanelStore.getState().setPanelWidth(450);
    expect(localStorage.getItem(WIDTH_STORAGE_KEY)).toBe("450");
  });
});

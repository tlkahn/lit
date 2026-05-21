import { describe, it, expect, beforeEach } from "vitest";
import { useBottomPanelStore } from "./bottomPanel";
import { useLlmResponseStore } from "./llmResponse";

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

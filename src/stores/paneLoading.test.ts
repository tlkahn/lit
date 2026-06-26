import { describe, it, expect, beforeEach } from "vitest";
import { usePaneLoadingStore } from "./paneLoading";

describe("paneLoading store", () => {
  beforeEach(() => {
    usePaneLoadingStore.setState({ loadingPaneIds: new Set() });
  });

  it("starts with empty loadingPaneIds", () => {
    expect(usePaneLoadingStore.getState().loadingPaneIds.size).toBe(0);
  });

  it("startLoading adds a pane id", () => {
    usePaneLoadingStore.getState().startLoading("pane-a");
    expect(usePaneLoadingStore.getState().loadingPaneIds.has("pane-a")).toBe(true);
  });

  it("stopLoading removes a pane id", () => {
    usePaneLoadingStore.getState().startLoading("pane-a");
    usePaneLoadingStore.getState().stopLoading("pane-a");
    expect(usePaneLoadingStore.getState().loadingPaneIds.has("pane-a")).toBe(false);
    expect(usePaneLoadingStore.getState().loadingPaneIds.size).toBe(0);
  });

  it("tracks multiple panes independently", () => {
    usePaneLoadingStore.getState().startLoading("pane-a");
    usePaneLoadingStore.getState().startLoading("pane-b");
    expect(usePaneLoadingStore.getState().loadingPaneIds.size).toBe(2);

    usePaneLoadingStore.getState().stopLoading("pane-a");
    expect(usePaneLoadingStore.getState().loadingPaneIds.has("pane-a")).toBe(false);
    expect(usePaneLoadingStore.getState().loadingPaneIds.has("pane-b")).toBe(true);
  });

  it("stopLoading on absent id is a no-op (returns same state)", () => {
    const before = usePaneLoadingStore.getState();
    usePaneLoadingStore.getState().stopLoading("nonexistent");
    const after = usePaneLoadingStore.getState();
    expect(before.loadingPaneIds).toBe(after.loadingPaneIds);
  });

  it("startLoading is idempotent (set semantics)", () => {
    usePaneLoadingStore.getState().startLoading("pane-a");
    usePaneLoadingStore.getState().startLoading("pane-a");
    expect(usePaneLoadingStore.getState().loadingPaneIds.size).toBe(1);
  });
});

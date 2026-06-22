import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePaneHistoryStore } from "../stores/paneHistory";

import { HistoryNavButtons } from "./HistoryNavButtons";

beforeEach(() => {
  usePaneHistoryStore.setState({ stacks: new Map() });
  return cleanup;
});

describe("HistoryNavButtons", () => {
  it("renders back and forward buttons with 'history-' prefix", () => {
    render(<HistoryNavButtons paneId="p1" testIdPrefix="history-" />);
    expect(screen.getByTestId("history-back")).toBeInTheDocument();
    expect(screen.getByTestId("history-forward")).toBeInTheDocument();
  });

  it("renders back and forward buttons with 'pane-history-' prefix", () => {
    render(<HistoryNavButtons paneId="p1" testIdPrefix="pane-history-" />);
    expect(screen.getByTestId("pane-history-back")).toBeInTheDocument();
    expect(screen.getByTestId("pane-history-forward")).toBeInTheDocument();
  });

  it("disables both buttons when no history", () => {
    render(<HistoryNavButtons paneId="p1" testIdPrefix="history-" />);
    expect(screen.getByTestId("history-back")).toBeDisabled();
    expect(screen.getByTestId("history-forward")).toBeDisabled();
  });

  it("enables back button when canGoBack is true", () => {
    usePaneHistoryStore.setState({
      stacks: new Map([["p1", { entries: ["a.md", "b.md"], index: 1 }]]),
    });
    render(<HistoryNavButtons paneId="p1" testIdPrefix="history-" />);
    expect(screen.getByTestId("history-back")).not.toBeDisabled();
    expect(screen.getByTestId("history-forward")).toBeDisabled();
  });

  it("enables forward button when canGoForward is true", () => {
    usePaneHistoryStore.setState({
      stacks: new Map([["p1", { entries: ["a.md", "b.md"], index: 0 }]]),
    });
    render(<HistoryNavButtons paneId="p1" testIdPrefix="history-" />);
    expect(screen.getByTestId("history-back")).toBeDisabled();
    expect(screen.getByTestId("history-forward")).not.toBeDisabled();
  });

  it("calls goBack(paneId) when back button is clicked", async () => {
    const goBackSpy = vi.fn(() => null);
    usePaneHistoryStore.setState({
      stacks: new Map([["p1", { entries: ["a.md", "b.md"], index: 1 }]]),
      goBack: goBackSpy,
    });
    render(<HistoryNavButtons paneId="p1" testIdPrefix="history-" />);
    await userEvent.click(screen.getByTestId("history-back"));
    expect(goBackSpy).toHaveBeenCalledWith("p1");
  });

  it("calls goForward(paneId) when forward button is clicked", async () => {
    const goForwardSpy = vi.fn(() => null);
    usePaneHistoryStore.setState({
      stacks: new Map([["p1", { entries: ["a.md", "b.md"], index: 0 }]]),
      goForward: goForwardSpy,
    });
    render(<HistoryNavButtons paneId="p1" testIdPrefix="history-" />);
    await userEvent.click(screen.getByTestId("history-forward"));
    expect(goForwardSpy).toHaveBeenCalledWith("p1");
  });

  it("has correct aria-labels", () => {
    render(<HistoryNavButtons paneId="p1" testIdPrefix="history-" />);
    expect(screen.getByTestId("history-back")).toHaveAttribute("aria-label", "Go back");
    expect(screen.getByTestId("history-forward")).toHaveAttribute("aria-label", "Go forward");
  });

  it("renders correct glyphs", () => {
    render(<HistoryNavButtons paneId="p1" testIdPrefix="history-" />);
    expect(screen.getByTestId("history-back").textContent).toBe("‹");
    expect(screen.getByTestId("history-forward").textContent).toBe("›");
  });
});

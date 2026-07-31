import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CardboxShortcutsOverlay } from "./CardboxShortcutsOverlay";

describe("CardboxShortcutsOverlay", () => {
  it("renders shortcut entries when open", () => {
    render(<CardboxShortcutsOverlay open={true} onClose={() => {}} />);
    expect(screen.getByTestId("shortcuts-overlay-panel")).toBeInTheDocument();
    const entries = screen.getAllByTestId("shortcut-entry");
    expect(entries.length).toBeGreaterThanOrEqual(9);
    // Verify known shortcuts are present
    expect(screen.getByText("Navigate cards in grid")).toBeInTheDocument();
    expect(screen.getByText("Toggle pin")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<CardboxShortcutsOverlay open={false} onClose={() => {}} />);
    expect(screen.queryByTestId("shortcuts-overlay-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("shortcuts-overlay-backdrop")).not.toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<CardboxShortcutsOverlay open={true} onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId("shortcuts-overlay-backdrop"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    render(<CardboxShortcutsOverlay open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("shortcuts-overlay-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when panel body is clicked", () => {
    const onClose = vi.fn();
    render(<CardboxShortcutsOverlay open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("shortcuts-overlay-panel"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("lists F to flip card", () => {
    render(<CardboxShortcutsOverlay open={true} onClose={() => {}} />);
    expect(screen.getByText(/flip card/i)).toBeInTheDocument();
    const flipEntry = screen.getByText(/flip card/i).closest('[data-testid="shortcut-entry"]')!;
    expect(flipEntry.querySelector("kbd")).toHaveTextContent("F");
  });

  it("lists the Q quote shortcut", () => {
    render(<CardboxShortcutsOverlay open={true} onClose={() => {}} />);
    const entry = screen
      .getByText(/quote selection into slip note/i)
      .closest('[data-testid="shortcut-entry"]')!;
    expect(entry.querySelector("kbd")).toHaveTextContent("Q");
  });

  it("describes N and C as working on the focused card (#982)", () => {
    render(<CardboxShortcutsOverlay open={true} onClose={() => {}} />);
    expect(screen.getByText("Toggle note (focused card)")).toBeInTheDocument();
    expect(screen.getByText("Show connections (focused card)")).toBeInTheDocument();
    expect(screen.queryByText("Toggle note (expanded card)")).not.toBeInTheDocument();
    expect(screen.queryByText("Show connections (expanded card)")).not.toBeInTheDocument();
  });

  it("calls onClose when ? is pressed (toggle off)", () => {
    const onClose = vi.fn();
    render(<CardboxShortcutsOverlay open={true} onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId("shortcuts-overlay-backdrop"), { key: "?" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

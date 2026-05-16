import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";

describe("SettingsModal", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(<SettingsModal open={false} onClose={vi.fn()} />);
    expect(container.querySelector("[data-testid='settings-modal-backdrop']")).toBeNull();
  });

  it("renders backdrop and dialog when open", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    expect(container.querySelector("[data-testid='settings-modal-backdrop']")).toBeTruthy();
    expect(container.querySelector("[data-testid='settings-modal-dialog']")).toBeTruthy();
  });

  it("shows title when open", () => {
    const { container } = render(<SettingsModal open={true} onClose={vi.fn()} />);
    expect(container.textContent).toContain("Settings");
  });

  it("Escape key calls onClose", () => {
    const onClose = vi.fn();
    render(<SettingsModal open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not listen for Escape when closed", () => {
    const onClose = vi.fn();
    render(<SettingsModal open={false} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal open={true} onClose={onClose} />);
    const btn = container.querySelector("[data-testid='settings-modal-close']")!;
    fireEvent.click(btn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

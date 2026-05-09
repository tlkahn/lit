import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, act } from "@testing-library/react";
import { LicenseEntryDialog } from "./LicenseEntryDialog";
import { useLicenseStore } from "../stores/license";

describe("LicenseEntryDialog", () => {
  beforeEach(() => {
    useLicenseStore.setState({
      state: "unknown",
      daysRemaining: null,
      licensedTo: null,
      loading: false,
      error: null,
    });
  });

  it("renders nothing when open=false", () => {
    const { container } = render(<LicenseEntryDialog open={false} onClose={vi.fn()} />);
    expect(container.querySelector("[data-testid='license-entry-dialog']")).toBeNull();
  });

  it("renders dialog with textarea and Activate button when open", () => {
    const { container } = render(<LicenseEntryDialog open={true} onClose={vi.fn()} />);
    expect(container.querySelector("[data-testid='license-entry-dialog']")).toBeTruthy();
    expect(container.querySelector("[data-testid='license-entry-input']")).toBeTruthy();
    expect(container.querySelector("[data-testid='license-entry-activate']")).toBeTruthy();
  });

  it("Activate button disabled when textarea empty", () => {
    const { container } = render(<LicenseEntryDialog open={true} onClose={vi.fn()} />);
    const btn = container.querySelector("[data-testid='license-entry-activate']") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("Activate button enabled when textarea has text", () => {
    const { container } = render(<LicenseEntryDialog open={true} onClose={vi.fn()} />);
    const textarea = container.querySelector("[data-testid='license-entry-input']")!;
    fireEvent.change(textarea, { target: { value: "LICENSE-KEY" } });
    const btn = container.querySelector("[data-testid='license-entry-activate']") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("clicking Activate calls store.activate with trimmed key", async () => {
    const activate = vi.fn().mockResolvedValue(true);
    useLicenseStore.setState({ activate });
    const { container } = render(<LicenseEntryDialog open={true} onClose={vi.fn()} />);
    const textarea = container.querySelector("[data-testid='license-entry-input']")!;
    fireEvent.change(textarea, { target: { value: "  KEY-123  " } });
    fireEvent.click(container.querySelector("[data-testid='license-entry-activate']")!);
    await waitFor(() => {
      expect(activate).toHaveBeenCalledWith("KEY-123");
    });
  });

  it("shows error message from store", () => {
    useLicenseStore.setState({ error: "Invalid key" });
    const { container } = render(<LicenseEntryDialog open={true} onClose={vi.fn()} />);
    const err = container.querySelector("[data-testid='license-entry-error']");
    expect(err).toBeTruthy();
    expect(err!.textContent).toContain("Invalid key");
  });

  it("clears error when textarea changes", () => {
    const clearError = vi.fn();
    useLicenseStore.setState({ error: "old error", clearError });
    const { container } = render(<LicenseEntryDialog open={true} onClose={vi.fn()} />);
    const textarea = container.querySelector("[data-testid='license-entry-input']")!;
    fireEvent.change(textarea, { target: { value: "new text" } });
    expect(clearError).toHaveBeenCalled();
  });

  it("calls onClose on successful activation", async () => {
    const activate = vi.fn().mockResolvedValue(true);
    useLicenseStore.setState({ activate });
    const onClose = vi.fn();
    const { container } = render(<LicenseEntryDialog open={true} onClose={onClose} />);
    const textarea = container.querySelector("[data-testid='license-entry-input']")!;
    fireEvent.change(textarea, { target: { value: "GOOD-KEY" } });
    fireEvent.click(container.querySelector("[data-testid='license-entry-activate']")!);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("does not close on failed activation", async () => {
    const activate = vi.fn().mockResolvedValue(false);
    useLicenseStore.setState({ activate });
    const onClose = vi.fn();
    const { container } = render(<LicenseEntryDialog open={true} onClose={onClose} />);
    const textarea = container.querySelector("[data-testid='license-entry-input']")!;
    fireEvent.change(textarea, { target: { value: "BAD-KEY" } });
    fireEvent.click(container.querySelector("[data-testid='license-entry-activate']")!);
    await waitFor(() => {
      expect(activate).toHaveBeenCalled();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape key calls onClose", () => {
    const onClose = vi.fn();
    render(<LicenseEntryDialog open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clears textarea when dialog reopens", () => {
    const { container, rerender } = render(<LicenseEntryDialog open={true} onClose={vi.fn()} />);
    const textarea = container.querySelector("[data-testid='license-entry-input']") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "some-key" } });
    expect(textarea.value).toBe("some-key");

    rerender(<LicenseEntryDialog open={false} onClose={vi.fn()} />);
    rerender(<LicenseEntryDialog open={true} onClose={vi.fn()} />);

    const reopened = container.querySelector("[data-testid='license-entry-input']") as HTMLTextAreaElement;
    expect(reopened.value).toBe("");
  });

  it("Activate button disabled while submitting", async () => {
    let resolveActivate!: (value: boolean) => void;
    const activate = vi.fn(() => new Promise<boolean>((r) => { resolveActivate = r; }));
    useLicenseStore.setState({ activate });
    const { container } = render(<LicenseEntryDialog open={true} onClose={vi.fn()} />);
    const textarea = container.querySelector("[data-testid='license-entry-input']")!;
    fireEvent.change(textarea, { target: { value: "KEY" } });
    const btn = container.querySelector("[data-testid='license-entry-activate']") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn.disabled).toBe(true);
    });

    await act(async () => {
      resolveActivate(true);
    });
    await waitFor(() => {
      expect(btn.disabled).toBe(false);
    });
  });
});

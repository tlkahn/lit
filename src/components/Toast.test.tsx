import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { Toast } from "./Toast";

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders message text when visible", () => {
    render(<Toast message="Saved!" visible={true} onDismiss={() => {}} />);
    const toast = document.body.querySelector("[data-testid='toast']");
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toContain("Saved!");
  });

  it("does not render when visible is false", () => {
    const { container } = render(<Toast message="Saved!" visible={false} onDismiss={() => {}} />);
    expect(container.querySelector("[data-testid='toast']")).toBeNull();
  });

  it("calls onDismiss after 3000ms", () => {
    const onDismiss = vi.fn();
    render(<Toast message="Done" visible={true} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders as a child of document.body via portal, not inside its parent container", () => {
    const { container } = render(<div id="wrapper"><Toast message="Hi" visible={true} onDismiss={() => {}} /></div>);
    const toastInsideWrapper = container.querySelector("[data-testid='toast']");
    expect(toastInsideWrapper).toBeNull();
    const toastInBody = document.body.querySelector("[data-testid='toast']");
    expect(toastInBody).not.toBeNull();
  });

  it("has fixed positioning classes", () => {
    render(<Toast message="Hi" visible={true} onDismiss={() => {}} />);
    const toast = document.body.querySelector("[data-testid='toast']")!;
    expect(toast.className).toContain("fixed");
    expect(toast.className).toContain("top-3");
    expect(toast.className).toContain("right-3");
  });

  it("resets auto-dismiss timer when message changes", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Toast message="First" visible={true} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(2000);
    expect(onDismiss).not.toHaveBeenCalled();
    rerender(<Toast message="Second" visible={true} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(2000);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

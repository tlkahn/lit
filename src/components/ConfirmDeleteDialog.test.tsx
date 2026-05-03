import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";

describe("ConfirmDeleteDialog", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <ConfirmDeleteDialog open={false} nodeName="Test" childCount={3} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='confirm-delete-dialog']")).toBeNull();
  });

  it("renders message with node name and child count", () => {
    const { container } = render(
      <ConfirmDeleteDialog open={true} nodeName="Section A" childCount={3} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const dialog = container.querySelector("[data-testid='confirm-delete-dialog']");
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toContain("Section A");
    expect(dialog!.textContent).toContain("3 children");
  });

  it("renders singular child for count of 1", () => {
    const { container } = render(
      <ConfirmDeleteDialog open={true} nodeName="X" childCount={1} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const dialog = container.querySelector("[data-testid='confirm-delete-dialog']");
    expect(dialog!.textContent).toContain("1 child?");
    expect(dialog!.textContent).not.toContain("children");
  });

  it("Delete button calls onConfirm", () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <ConfirmDeleteDialog open={true} nodeName="X" childCount={2} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(container.querySelector("[data-testid='confirm-delete-btn']")!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("Cancel button calls onCancel", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDeleteDialog open={true} nodeName="X" childCount={2} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(container.querySelector("[data-testid='confirm-delete-cancel']")!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDeleteDialog open={true} nodeName="X" childCount={2} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

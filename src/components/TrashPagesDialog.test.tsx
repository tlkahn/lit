import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrashPagesDialog } from "./TrashPagesDialog";

describe("TrashPagesDialog", () => {
  it("renders nothing when paths is empty", () => {
    const { container } = render(
      <TrashPagesDialog paths={[]} labels={[]} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows single-path copy with the title", () => {
    render(
      <TrashPagesDialog
        paths={["a.md"]}
        labels={["Note A"]}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = screen.getByTestId("confirm-delete-dialog");
    expect(dialog.textContent).toContain("Note A");
    expect(dialog.textContent).toContain("trash");
  });

  it("shows count and label list for multiple paths", () => {
    render(
      <TrashPagesDialog
        paths={["a.md", "b.md"]}
        labels={["Note A", "Note B"]}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = screen.getByTestId("confirm-delete-dialog");
    expect(dialog.textContent).toContain("2 pages");
    expect(dialog.textContent).toContain("Note A");
    expect(dialog.textContent).toContain("Note B");
  });

  it("cancel button fires onCancel", () => {
    const onCancel = vi.fn();
    render(
      <TrashPagesDialog
        paths={["a.md"]}
        labels={["Note A"]}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-delete-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("confirm button fires onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <TrashPagesDialog
        paths={["a.md", "b.md"]}
        labels={["Note A", "Note B"]}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-delete-btn"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("Escape key fires onCancel", () => {
    const onCancel = vi.fn();
    render(
      <TrashPagesDialog
        paths={["a.md"]}
        labels={["Note A"]}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("confirm-delete-backdrop"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

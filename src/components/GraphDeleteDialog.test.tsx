import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { mockInvoke } from "../test/tauri-mock";
import { useGraphSelectionStore } from "../stores/graphSelection";
import { GraphDeleteDialog } from "./GraphDeleteDialog";

describe("GraphDeleteDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGraphSelectionStore.setState({ selectedNodes: [], selectionMode: "none" });
    mockInvoke((cmd) => {
      switch (cmd) {
        case "trash_page":
          return undefined;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
  });

  it("renders nothing when deleteConfirm is null", () => {
    const { container } = render(
      <GraphDeleteDialog deleteConfirm={null} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows single-document message", () => {
    render(
      <GraphDeleteDialog
        deleteConfirm={{ nodeIds: ["a.md"], labels: ["Note A"] }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("confirm-delete-dialog").textContent).toContain("Note A");
    expect(screen.getByTestId("confirm-delete-dialog").textContent).toContain("trash");
  });

  it("shows multi-document message with list", () => {
    render(
      <GraphDeleteDialog
        deleteConfirm={{ nodeIds: ["a.md", "b.md"], labels: ["Note A", "Note B"] }}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByTestId("confirm-delete-dialog");
    expect(dialog.textContent).toContain("2 documents");
    expect(dialog.textContent).toContain("Note A");
    expect(dialog.textContent).toContain("Note B");
  });

  it("cancel button calls onClose", () => {
    const onClose = vi.fn();
    render(
      <GraphDeleteDialog
        deleteConfirm={{ nodeIds: ["a.md"], labels: ["Note A"] }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-delete-cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape key calls onClose", () => {
    const onClose = vi.fn();
    render(
      <GraphDeleteDialog
        deleteConfirm={{ nodeIds: ["a.md"], labels: ["Note A"] }}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("confirm-delete-backdrop"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("delete button calls deletePage for each ID, clears selection, calls onClose", async () => {
    const trashedIds: string[] = [];
    mockInvoke((cmd, args) => {
      if (cmd === "trash_page") {
        trashedIds.push((args as { relativePath: string }).relativePath);
        return undefined;
      }
      throw new Error(`Unknown: ${cmd}`);
    });

    useGraphSelectionStore.getState().toggleNode("a.md");
    useGraphSelectionStore.getState().toggleNode("b.md");

    const onClose = vi.fn();
    render(
      <GraphDeleteDialog
        deleteConfirm={{ nodeIds: ["a.md", "b.md"], labels: ["A", "B"] }}
        onClose={onClose}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-delete-btn"));
    });

    expect(onClose).toHaveBeenCalled();
    expect(useGraphSelectionStore.getState().selectedNodes).toEqual([]);
    expect(trashedIds).toContain("a.md");
    expect(trashedIds).toContain("b.md");
  });
});

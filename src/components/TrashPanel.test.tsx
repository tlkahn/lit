import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrashPanel } from "./TrashPanel";
import { mockInvoke, mockListen, emitMockEvent, resetListenMock } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";
import type { TrashEntry } from "../lib/ipc";

const sampleTrash: TrashEntry[] = [
  { trash_name: "a.123.md", original_path: "notes/a.md", deleted_at: 123 },
  { trash_name: "b.456.md", original_path: "b.md", deleted_at: 456 },
];

beforeEach(() => {
  useWorkspaceStore.setState({
    workspacePath: "/test",
    trashItems: [],
  });
  resetListenMock();
  mockListen();
});

describe("TrashPanel", () => {
  it("shows empty message when no items", async () => {
    mockInvoke((cmd) => {
      if (cmd === "list_trash") return [];
      if (cmd === "show_trash_context_menu") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<TrashPanel />);

    await waitFor(() => {
      expect(screen.getByText("Trash is empty")).toBeInTheDocument();
    });
  });

  it("renders trashed items with original path", async () => {
    mockInvoke((cmd) => {
      if (cmd === "list_trash") return sampleTrash;
      if (cmd === "show_trash_context_menu") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<TrashPanel />);

    await waitFor(() => {
      expect(screen.getByText("notes/a.md")).toBeInTheDocument();
    });
    expect(screen.getByText("b.md")).toBeInTheDocument();
  });

  it("right-click calls show_trash_context_menu with trashName", async () => {
    mockInvoke((cmd) => {
      if (cmd === "list_trash") return sampleTrash;
      if (cmd === "show_trash_context_menu") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<TrashPanel />);

    await waitFor(() => {
      expect(screen.getByText("notes/a.md")).toBeInTheDocument();
    });

    const item = screen.getByText("notes/a.md");
    await userEvent.pointer({ keys: "[MouseRight]", target: item });

    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("show_trash_context_menu", {
      trashName: "a.123.md",
    });
  });

  it("restore event triggers restorePage", async () => {
    let restoredName: string | null = null;
    mockInvoke((cmd, args) => {
      if (cmd === "list_trash") return sampleTrash;
      if (cmd === "show_trash_context_menu") return null;
      if (cmd === "restore_page") {
        restoredName = (args as Record<string, unknown>)?.trashName as string;
        return "notes/a.md";
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<TrashPanel />);

    await waitFor(() => {
      expect(screen.getByText("notes/a.md")).toBeInTheDocument();
    });

    emitMockEvent("context-menu://trash/restore", { trash_name: "a.123.md" });

    await waitFor(() => {
      expect(restoredName).toBe("a.123.md");
    });
  });

  it("purge event triggers purgePage", async () => {
    let purgedName: string | null = null;
    mockInvoke((cmd, args) => {
      if (cmd === "list_trash") return sampleTrash;
      if (cmd === "show_trash_context_menu") return null;
      if (cmd === "purge_page") {
        purgedName = (args as Record<string, unknown>)?.trashName as string;
        return null;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<TrashPanel />);

    await waitFor(() => {
      expect(screen.getByText("notes/a.md")).toBeInTheDocument();
    });

    emitMockEvent("context-menu://trash/purge", { trash_name: "b.456.md" });

    await waitFor(() => {
      expect(purgedName).toBe("b.456.md");
    });
  });

  it("Empty Trash button visible when items exist", async () => {
    mockInvoke((cmd) => {
      if (cmd === "list_trash") return sampleTrash;
      if (cmd === "show_trash_context_menu") return null;
      throw new Error(`Unknown command: ${cmd}`);
    });

    render(<TrashPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("empty-trash-btn")).toBeInTheDocument();
    });
    expect(screen.getByText("Empty Trash")).toBeInTheDocument();
  });

  it("Empty Trash does not proceed when confirm is cancelled", async () => {
    let emptyTrashCalled = false;
    mockInvoke((cmd) => {
      if (cmd === "list_trash") return sampleTrash;
      if (cmd === "show_trash_context_menu") return null;
      if (cmd === "empty_trash") {
        emptyTrashCalled = true;
        return null;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<TrashPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("empty-trash-btn")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("empty-trash-btn"));
    expect(emptyTrashCalled).toBe(false);

    vi.mocked(window.confirm).mockRestore();
  });

  it("Empty Trash proceeds when confirm is accepted", async () => {
    let emptyTrashCalled = false;
    mockInvoke((cmd) => {
      if (cmd === "list_trash") return sampleTrash;
      if (cmd === "show_trash_context_menu") return null;
      if (cmd === "empty_trash") {
        emptyTrashCalled = true;
        return null;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<TrashPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("empty-trash-btn")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("empty-trash-btn"));
    expect(emptyTrashCalled).toBe(true);

    vi.mocked(window.confirm).mockRestore();
  });
});

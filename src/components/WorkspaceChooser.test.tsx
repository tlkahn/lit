import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceChooser } from "./WorkspaceChooser";
import { mockInvoke, mockDialogOpen } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";

describe("WorkspaceChooser", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspacePath: null,
      pages: [],
      currentPagePath: null,
      loading: false,
      error: null,
    });

    mockInvoke((cmd) => {
      if (cmd === "open_workspace") return [];
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  it("renders Open Workspace button", () => {
    render(<WorkspaceChooser />);
    expect(screen.getByText("Open Workspace")).toBeInTheDocument();
  });

  it("clicking button triggers dialog and opens workspace", async () => {
    const user = userEvent.setup();
    mockDialogOpen("/selected/folder");

    render(<WorkspaceChooser />);
    await user.click(screen.getByText("Open Workspace"));

    const { open } = await import("@tauri-apps/plugin-dialog");
    expect(open).toHaveBeenCalledWith({ directory: true });
  });

  it("does not open workspace if dialog cancelled", async () => {
    const user = userEvent.setup();
    mockDialogOpen(null);

    render(<WorkspaceChooser />);
    await user.click(screen.getByText("Open Workspace"));

    expect(useWorkspaceStore.getState().workspacePath).toBeNull();
  });
});

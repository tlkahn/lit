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
      if (cmd === "open_workspace_window") return "workspace-1";
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  it("renders Open Workspace button", () => {
    render(<WorkspaceChooser />);
    expect(screen.getByText("Open Workspace")).toBeInTheDocument();
  });

  it("renders Open in New Window button", () => {
    render(<WorkspaceChooser />);
    expect(screen.getByText("Open in New Window")).toBeInTheDocument();
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

  it("shows recent workspaces list when entries exist", () => {
    localStorage.setItem("lit-recent-workspaces", JSON.stringify(["/path/a", "/path/b"]));

    render(<WorkspaceChooser />);
    expect(screen.getByTestId("recent-workspaces")).toBeInTheDocument();
    expect(screen.getByText("/path/a")).toBeInTheDocument();
    expect(screen.getByText("/path/b")).toBeInTheDocument();
  });

  it("clicking recent workspace opens it", async () => {
    const user = userEvent.setup();
    localStorage.setItem("lit-recent-workspaces", JSON.stringify(["/recent/ws"]));

    render(<WorkspaceChooser />);
    await user.click(screen.getByText("/recent/ws"));

    expect(useWorkspaceStore.getState().workspacePath).toBe("/recent/ws");
  });
});

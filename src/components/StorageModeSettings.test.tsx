import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import { StorageModeSettings } from "./StorageModeSettings";
import { mockInvoke, mockListen, resetListenMock } from "../test/tauri-mock";
import { useWorkspaceStore } from "../stores/workspace";

let invokeCalls: { cmd: string; args: Record<string, unknown> }[];

function setupInvoke(getMode: () => string) {
  invokeCalls = [];
  mockInvoke((cmd, args) => {
    invokeCalls.push({ cmd, args: args ?? {} });
    switch (cmd) {
      case "get_workspace_storage_mode":
        return getMode();
      case "set_workspace_storage_mode":
        return {
          from: getMode(),
          to: (args as { mode: string }).mode,
          migrated: 5,
          phase: "config_only",
        };
      default:
        return undefined;
    }
  });
}

beforeEach(() => {
  mockListen();
  useWorkspaceStore.setState({
    workspacePath: "/vault",
    pages: [
      { title: "A", relative_path: "A.md", frontmatter: {}, created_at: 1, modified_at: 2, file_type: "markdown" },
      { title: "B", relative_path: "B.md", frontmatter: {}, created_at: 1, modified_at: 2, file_type: "markdown" },
    ] as never,
    storageMode: "files",
  });
});

afterEach(() => {
  resetListenMock();
  vi.restoreAllMocks();
});

describe("StorageModeSettings", () => {
  it("renders the current mode on mount", async () => {
    setupInvoke(() => "db");
    const { container } = render(<StorageModeSettings />);
    await waitFor(() => {
      const dbBtn = container.querySelector("[data-testid='settings-storageMode-db']");
      expect(dbBtn?.getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("clicking the other mode shows the confirmation dialog and does NOT call set yet", async () => {
    setupInvoke(() => "db");
    const { container, getByTestId } = render(<StorageModeSettings />);
    await waitFor(() => {
      expect(container.querySelector("[data-testid='settings-storageMode-files']")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.click(getByTestId("settings-storageMode-files"));
    });
    expect(getByTestId("storage-mode-confirm")).toBeTruthy();
    expect(invokeCalls.some((c) => c.cmd === "set_workspace_storage_mode")).toBe(false);
  });

  it("confirming calls setWorkspaceStorageMode with the target mode and reloads the workspace", async () => {
    setupInvoke(() => "db");
    const reloadSpy = vi.fn(() => Promise.resolve());
    useWorkspaceStore.setState({ reloadWorkspace: reloadSpy });
    const { getByTestId } = render(<StorageModeSettings />);
    await waitFor(() => getByTestId("settings-storageMode-files"));
    await act(async () => {
      fireEvent.click(getByTestId("settings-storageMode-files"));
    });
    await act(async () => {
      fireEvent.click(getByTestId("storage-mode-confirm-yes"));
    });
    await waitFor(() => {
      const call = invokeCalls.find((c) => c.cmd === "set_workspace_storage_mode");
      expect(call).toBeTruthy();
      expect(call!.args).toEqual({ mode: "files" });
    });
    await waitFor(() => expect(reloadSpy).toHaveBeenCalled());
  });

  it("cancel leaves mode unchanged and closes the dialog", async () => {
    setupInvoke(() => "db");
    const { container, getByTestId, queryByTestId } = render(<StorageModeSettings />);
    await waitFor(() => getByTestId("settings-storageMode-files"));
    await act(async () => {
      fireEvent.click(getByTestId("settings-storageMode-files"));
    });
    await act(async () => {
      fireEvent.click(getByTestId("storage-mode-confirm-no"));
    });
    expect(queryByTestId("storage-mode-confirm")).toBeNull();
    expect(invokeCalls.some((c) => c.cmd === "set_workspace_storage_mode")).toBe(false);
    const dbBtn = container.querySelector("[data-testid='settings-storageMode-db']");
    expect(dbBtn?.getAttribute("aria-pressed")).toBe("true");
  });

  it("set failure shows an error and keeps the prior mode pressed", async () => {
    invokeCalls = [];
    mockInvoke((cmd, args) => {
      invokeCalls.push({ cmd, args: args ?? {} });
      if (cmd === "get_workspace_storage_mode") return "db";
      if (cmd === "set_workspace_storage_mode") throw new Error("boom");
      return undefined;
    });
    const { container, getByTestId } = render(<StorageModeSettings />);
    await waitFor(() => getByTestId("settings-storageMode-files"));
    await act(async () => {
      fireEvent.click(getByTestId("settings-storageMode-files"));
    });
    await act(async () => {
      fireEvent.click(getByTestId("storage-mode-confirm-yes"));
    });
    await waitFor(() => expect(getByTestId("storage-mode-error")).toBeTruthy());
    const dbBtn = container.querySelector("[data-testid='settings-storageMode-db']");
    expect(dbBtn?.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders a disabled note when no workspace is open", async () => {
    useWorkspaceStore.setState({ workspacePath: null });
    setupInvoke(() => "files");
    const { queryByTestId, getByTestId } = render(<StorageModeSettings />);
    expect(getByTestId("storage-mode-no-workspace")).toBeTruthy();
    expect(queryByTestId("settings-storageMode-files")).toBeNull();
  });
});

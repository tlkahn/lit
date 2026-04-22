import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MenuBar } from "./MenuBar";
import { mockInvoke, mockDialogOpen } from "../test/tauri-mock";
import { useThemeStore } from "../stores/theme";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";

const defaultProps = {
  theme: "light" as const,
  toggleTheme: vi.fn(),
  position: "left" as const,
  togglePosition: vi.fn(),
};

describe("MenuBar", () => {
  beforeEach(() => {
    defaultProps.toggleTheme = vi.fn();
    defaultProps.togglePosition = vi.fn();

    useThemeStore.setState({
      activeThemeId: null,
      availableThemes: [],
    });

    mockInvoke((cmd) => {
      switch (cmd) {
        case "list_themes":
          return [];
        case "open_workspace_window":
          return "new-window";
        case "get_themes_directory":
          return "/themes";
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
  });

  it("opens File menu on click", async () => {
    const user = userEvent.setup();
    render(<MenuBar {...defaultProps} />);
    await user.click(screen.getByText("File"));
    expect(screen.getByText("Open Another Workspace")).toBeInTheDocument();
  });

  it("closes File menu on second click", async () => {
    const user = userEvent.setup();
    render(<MenuBar {...defaultProps} />);
    await user.click(screen.getByText("File"));
    expect(screen.getByText("Open Another Workspace")).toBeInTheDocument();
    await user.click(screen.getByText("File"));
    expect(screen.queryByText("Open Another Workspace")).not.toBeInTheDocument();
  });

  it("switches menu on hover after opening one", async () => {
    const user = userEvent.setup();
    render(<MenuBar {...defaultProps} />);
    await user.click(screen.getByText("File"));
    expect(screen.getByText("Open Another Workspace")).toBeInTheDocument();
    await user.hover(screen.getByText("View"));
    expect(screen.getByText("Dark Mode")).toBeInTheDocument();
    expect(screen.queryByText("Open Another Workspace")).not.toBeInTheDocument();
  });

  it("calls dialog for Open Another Workspace", async () => {
    const user = userEvent.setup();
    mockDialogOpen("/new/workspace");
    render(<MenuBar {...defaultProps} />);
    await user.click(screen.getByText("File"));
    await user.click(screen.getByText("Open Another Workspace"));
    await waitFor(() => {
      expect(dialogOpen).toHaveBeenCalledWith({ directory: true });
    });
  });

  it("toggles dark mode from View menu", async () => {
    const user = userEvent.setup();
    render(<MenuBar {...defaultProps} />);
    await user.click(screen.getByText("View"));
    await user.click(screen.getByText("Dark Mode"));
    expect(defaultProps.toggleTheme).toHaveBeenCalled();
  });

  it("shows checkmark for dark mode when active", async () => {
    const user = userEvent.setup();
    render(<MenuBar {...defaultProps} theme="dark" />);
    await user.click(screen.getByText("View"));
    const darkModeItem = screen.getByText("Dark Mode").closest("button")!;
    expect(darkModeItem.textContent).toContain("✓");
  });

  it("shows checkmark for active sidebar position", async () => {
    const user = userEvent.setup();
    render(<MenuBar {...defaultProps} position="left" />);
    await user.click(screen.getByText("View"));
    const leftItem = screen.getByText("Sidebar Left").closest("button")!;
    const rightItem = screen.getByText("Sidebar Right").closest("button")!;
    expect(leftItem.textContent).toContain("✓");
    expect(rightItem.textContent).not.toContain("✓");
  });

  it("toggles sidebar position from View menu", async () => {
    const user = userEvent.setup();
    render(<MenuBar {...defaultProps} position="left" />);
    await user.click(screen.getByText("View"));
    await user.click(screen.getByText("Sidebar Right"));
    expect(defaultProps.togglePosition).toHaveBeenCalled();
  });

  it("does not toggle when clicking already-active sidebar position", async () => {
    const user = userEvent.setup();
    render(<MenuBar {...defaultProps} position="left" />);
    await user.click(screen.getByText("View"));
    await user.click(screen.getByText("Sidebar Left"));
    expect(defaultProps.togglePosition).not.toHaveBeenCalled();
  });

  it("closes menus on Escape", async () => {
    const user = userEvent.setup();
    render(<MenuBar {...defaultProps} />);
    await user.click(screen.getByText("View"));
    expect(screen.getByText("Dark Mode")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Dark Mode")).not.toBeInTheDocument();
  });

  it("closes menus on click outside", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <MenuBar {...defaultProps} />
        <div data-testid="outside">outside</div>
      </div>,
    );
    await user.click(screen.getByText("View"));
    expect(screen.getByText("Dark Mode")).toBeInTheDocument();
    await user.click(screen.getByTestId("outside"));
    expect(screen.queryByText("Dark Mode")).not.toBeInTheDocument();
  });

  it("shows theme submenu on hover", async () => {
    useThemeStore.setState({
      activeThemeId: null,
      availableThemes: [
        { name: "Nord", version: "1.0", author: "test", directory_name: "nord" },
      ],
    });

    const user = userEvent.setup();
    render(<MenuBar {...defaultProps} />);
    await user.click(screen.getByText("View"));
    await user.hover(screen.getByText("Theme"));
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("Nord")).toBeInTheDocument();
    expect(screen.getByText("Open themes folder")).toBeInTheDocument();
  });
});

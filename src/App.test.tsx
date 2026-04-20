import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { mockInvoke } from "./test/tauri-mock";

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("App", () => {
  beforeEach(() => {
    mockMatchMedia(false);
    document.documentElement.classList.remove("dark");
    mockInvoke((cmd) => {
      if (cmd === "get_app_info") {
        return { name: "Lit", version: "0.1.0" };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  it("renders sidebar", async () => {
    render(<App />);
    expect(screen.getByText("Pages")).toBeInTheDocument();
  });

  it("displays app info from backend", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("app-info")).toHaveTextContent("Lit v0.1.0");
    });
  });

  it("has a theme toggle that switches to dark mode", async () => {
    const user = userEvent.setup();
    render(<App />);
    const toggle = screen.getByLabelText("Switch to dark mode");
    await user.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("renders sidebar on the left by default", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("app-info")).toBeInTheDocument();
    });
    const container = screen.getByText("Pages").closest("aside")!.parentElement!;
    expect(container.className).toContain("flex-row");
    expect(container.className).not.toContain("flex-row-reverse");
  });

  it("position toggle moves sidebar to the right", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("app-info")).toBeInTheDocument();
    });
    const toggle = screen.getByLabelText("Move sidebar to right");
    await user.click(toggle);
    const container = screen.getByText("Pages").closest("aside")!.parentElement!;
    expect(container.className).toContain("flex-row-reverse");
  });
});

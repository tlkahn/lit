import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestConnectionButton } from "./TestConnectionButton";

vi.mock("../lib/ipc", () => ({
  testLlmConnection: vi.fn(),
}));

describe("TestConnectionButton", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a Test Connection button", () => {
    render(<TestConnectionButton model="gpt-4o" />);
    const btn = screen.getByTestId("test-connection-btn");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("Test Connection");
  });

  it("shows Testing... and disables button while in progress", async () => {
    const { testLlmConnection } = await import("../lib/ipc");
    (testLlmConnection as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    render(<TestConnectionButton model="gpt-4o" />);
    await userEvent.click(screen.getByTestId("test-connection-btn"));

    const btn = screen.getByTestId("test-connection-btn");
    expect(btn).toHaveTextContent("Testing...");
    expect(btn).toBeDisabled();
  });

  it("shows Connected on success", async () => {
    const { testLlmConnection } = await import("../lib/ipc");
    (testLlmConnection as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(<TestConnectionButton model="gpt-4o" />);
    await userEvent.click(screen.getByTestId("test-connection-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("test-connection-status")).toHaveTextContent("Connected");
    });
  });

  it("shows error message on failure", async () => {
    const { testLlmConnection } = await import("../lib/ipc");
    (testLlmConnection as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Invalid API key"));

    render(<TestConnectionButton model="gpt-4o" />);
    await userEvent.click(screen.getByTestId("test-connection-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("test-connection-status")).toHaveTextContent("Invalid API key");
    });
  });

  it("passes baseUrl to testLlmConnection when provided", async () => {
    const { testLlmConnection } = await import("../lib/ipc");
    (testLlmConnection as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(<TestConnectionButton model="gpt-4o" baseUrl="https://custom.api" />);
    await userEvent.click(screen.getByTestId("test-connection-btn"));

    expect(testLlmConnection).toHaveBeenCalledWith("gpt-4o", "https://custom.api", undefined);
  });

  it("success status uses text-text-success theme class, not hardcoded green", async () => {
    const { testLlmConnection } = await import("../lib/ipc");
    (testLlmConnection as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(<TestConnectionButton model="gpt-4o" />);
    await userEvent.click(screen.getByTestId("test-connection-btn"));

    await waitFor(() => {
      const status = screen.getByTestId("test-connection-status");
      expect(status.className).toContain("text-text-success");
      expect(status.className).not.toMatch(/text-green-\d+/);
    });
  });

  it("auto-dismisses success status after 3 seconds", async () => {
    vi.useFakeTimers();
    const { testLlmConnection } = await import("../lib/ipc");
    (testLlmConnection as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(<TestConnectionButton model="gpt-4o" />);
    await act(async () => {
      screen.getByTestId("test-connection-btn").click();
    });

    expect(screen.getByTestId("test-connection-status")).toHaveTextContent("Connected");

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByTestId("test-connection-status")).toBeNull();
  });

  it("does not auto-dismiss error status", async () => {
    vi.useFakeTimers();
    const { testLlmConnection } = await import("../lib/ipc");
    (testLlmConnection as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Bad key"));

    render(<TestConnectionButton model="gpt-4o" />);
    await act(async () => {
      screen.getByTestId("test-connection-btn").click();
    });

    expect(screen.getByTestId("test-connection-status")).toHaveTextContent("Bad key");

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByTestId("test-connection-status")).toHaveTextContent("Bad key");
  });
});

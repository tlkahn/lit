import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import { ZoteroSettings } from "./ZoteroSettings";
import { usePreferencesStore } from "../stores/preferences";

vi.mock("../lib/ipc", async () => {
  const actual = await vi.importActual<typeof import("../lib/ipc")>("../lib/ipc");
  return {
    ...actual,
    testZoteroConnection: vi.fn(),
    setPreference: vi.fn(() => Promise.resolve()),
  };
});

// Import the mocked module AFTER vi.mock() so we get the mock instances
const ipcMock = await import("../lib/ipc");
const mockTestZoteroConnection = ipcMock.testZoteroConnection as ReturnType<typeof vi.fn>;
const mockSetPreference = ipcMock.setPreference as ReturnType<typeof vi.fn>;

beforeEach(() => {
  usePreferencesStore.setState({ zoteroDatabasePath: "" });
  vi.clearAllMocks();
  mockSetPreference.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ZoteroSettings", () => {
  it("renders database path input with placeholder", () => {
    const { container } = render(<ZoteroSettings />);
    const input = container.querySelector("[data-testid='settings-zoteroDatabasePath']") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.placeholder).toBe("~/Zotero/zotero.sqlite");
  });

  it("renders Browse button", () => {
    const { container } = render(<ZoteroSettings />);
    const btn = container.querySelector("[data-testid='zotero-browse-btn']");
    expect(btn).toBeTruthy();
    expect(btn!.textContent).toBe("Browse");
  });

  it("renders Test Connection button", () => {
    const { container } = render(<ZoteroSettings />);
    const btn = container.querySelector("[data-testid='zotero-test-connection-btn']");
    expect(btn).toBeTruthy();
    expect(btn!.textContent).toBe("Test Connection");
  });

  it("Browse button calls dialog open and updates path", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    (open as ReturnType<typeof vi.fn>).mockResolvedValue("/custom/path/zotero.sqlite");
    const { container } = render(<ZoteroSettings />);
    const btn = container.querySelector("[data-testid='zotero-browse-btn']") as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(open).toHaveBeenCalled();
    expect(usePreferencesStore.getState().zoteroDatabasePath).toBe("/custom/path/zotero.sqlite");
    expect(mockSetPreference).toHaveBeenCalledWith("zotero.databasePath", "/custom/path/zotero.sqlite");
  });

  it("Test Connection shows success message", async () => {
    mockTestZoteroConnection.mockResolvedValue({
      pdfCount: 10,
      annotationCount: 50,
      dbVersion: "6.0.30",
    });

    const { container } = render(<ZoteroSettings />);
    const btn = container.querySelector("[data-testid='zotero-test-connection-btn']") as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      const status = container.querySelector("[data-testid='zotero-test-status']");
      expect(status).toBeTruthy();
      expect(status!.textContent).toContain("10 PDFs");
      expect(status!.textContent).toContain("50 annotations");
    });
  });

  it("Test Connection shows error on failure", async () => {
    mockTestZoteroConnection.mockRejectedValue(new Error("Database not found"));

    const { container } = render(<ZoteroSettings />);
    const btn = container.querySelector("[data-testid='zotero-test-connection-btn']") as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      const status = container.querySelector("[data-testid='zotero-test-status']");
      expect(status).toBeTruthy();
      expect(status!.textContent).toContain("Database not found");
      expect(status!.className).toContain("text-error");
    });
  });

  it("committing path calls setPreference", () => {
    const { container } = render(<ZoteroSettings />);
    const input = container.querySelector("[data-testid='settings-zoteroDatabasePath']") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "/my/path/zotero.sqlite" } });
    fireEvent.blur(input);

    expect(mockSetPreference).toHaveBeenCalledWith("zotero.databasePath", "/my/path/zotero.sqlite");
  });

  it("committing empty path sends null to setPreference", () => {
    usePreferencesStore.setState({ zoteroDatabasePath: "/old/path" });
    const { container } = render(<ZoteroSettings />);
    const input = container.querySelector("[data-testid='settings-zoteroDatabasePath']") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(mockSetPreference).toHaveBeenCalledWith("zotero.databasePath", null);
  });

  it("singular text for 1 PDF", async () => {
    mockTestZoteroConnection.mockResolvedValue({
      pdfCount: 1,
      annotationCount: 1,
      dbVersion: "6.0.30",
    });

    const { container } = render(<ZoteroSettings />);
    const btn = container.querySelector("[data-testid='zotero-test-connection-btn']") as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      const status = container.querySelector("[data-testid='zotero-test-status']");
      expect(status).toBeTruthy();
      expect(status!.textContent).toBe("Found 1 PDF with 1 annotation");
    });
  });
});

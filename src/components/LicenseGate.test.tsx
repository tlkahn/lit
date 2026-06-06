import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { LicenseGate } from "./LicenseGate";
import { useLicenseStore } from "../stores/license";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

import { openUrl } from "@tauri-apps/plugin-opener";

describe("LicenseGate", () => {
  beforeEach(() => {
    useLicenseStore.setState({
      state: "unknown",
      licensedTo: null,
      source: null,
      expiresAt: null,
      expiryDate: null,
      loading: true,
      error: null,
      fetchStatus: vi.fn(),
      activate: vi.fn().mockResolvedValue(true),
      clearError: vi.fn(),
    });
  });

  it("shows loading indicator while state is 'unknown'", () => {
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("child")).toBeNull();
    expect(queryByTestId("license-loading")).toBeTruthy();
  });

  it("renders children when state is 'licensed'", () => {
    useLicenseStore.setState({ state: "licensed", loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("child")).toBeTruthy();
  });

  it("shows splash and hides children when state is 'unlicensed'", () => {
    useLicenseStore.setState({ state: "unlicensed", loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("child")).toBeNull();
    const splash = queryByTestId("license-splash");
    expect(splash).toBeTruthy();
    expect(queryByTestId("splash-buy-license")).toBeTruthy();
    expect(queryByTestId("splash-enter-key")).toBeTruthy();
    expect(queryByTestId("splash-export-data")).toBeTruthy();
  });

  it("shows splash and hides children when state is 'license_expired'", () => {
    useLicenseStore.setState({ state: "license_expired", licensedTo: "Alice", expiryDate: "2024-12-31", loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("child")).toBeNull();
    const splash = queryByTestId("license-splash");
    expect(splash).toBeTruthy();
    expect(splash!.textContent).toContain("expired");
    expect(splash!.textContent).toContain("2024-12-31");
  });

  it("license_expired splash greets the licensee by name", () => {
    useLicenseStore.setState({ state: "license_expired", licensedTo: "Alice", expiryDate: "2024-12-31", loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("license-splash")!.textContent).toContain("Alice");
  });

  it("splash Buy License button calls openUrl", () => {
    useLicenseStore.setState({ state: "unlicensed", loading: false });
    const { container } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    fireEvent.click(container.querySelector("[data-testid='splash-buy-license']")!);
    expect(openUrl).toHaveBeenCalledWith("https://lit.solar/buy");
  });

  it("splash Enter License Key button opens LicenseEntryDialog", () => {
    useLicenseStore.setState({ state: "unlicensed", loading: false });
    const { container, queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    fireEvent.click(container.querySelector("[data-testid='splash-enter-key']")!);
    expect(queryByTestId("license-entry-dialog")).toBeTruthy();
  });

  it("splash Export My Data button is present", () => {
    useLicenseStore.setState({ state: "license_expired", loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("splash-export-data")).toBeTruthy();
  });

  it("calls fetchStatus on mount", () => {
    const fetchStatus = vi.fn();
    useLicenseStore.setState({ fetchStatus });
    render(<LicenseGate><div /></LicenseGate>);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("loading screen shows a spinner", () => {
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    const loading = queryByTestId("license-loading")!;
    expect(loading).toBeTruthy();
    const svg = loading.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg!.classList.contains("animate-spin")).toBe(true);
  });
});

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
      daysRemaining: null,
      licensedTo: null,
      loading: true,
      error: null,
      fetchStatus: vi.fn(),
      activate: vi.fn().mockResolvedValue(true),
      clearError: vi.fn(),
    });
  });

  it("shows loading indicator while state is 'unknown'", () => {
    const { container, queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("child")).toBeNull();
    expect(queryByTestId("license-loading")).toBeTruthy();
  });

  it("renders children when state is 'trial'", () => {
    useLicenseStore.setState({ state: "trial", daysRemaining: 10, loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("child")).toBeTruthy();
  });

  it("renders children when state is 'licensed'", () => {
    useLicenseStore.setState({ state: "licensed", loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("child")).toBeTruthy();
  });

  it("renders children when state is 'expiring_soon'", () => {
    useLicenseStore.setState({ state: "expiring_soon", daysRemaining: 2, loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("child")).toBeTruthy();
  });

  it("shows expired overlay when state is 'expired'", () => {
    useLicenseStore.setState({ state: "expired", daysRemaining: 0, loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("child")).toBeNull();
    const overlay = queryByTestId("license-expired-overlay");
    expect(overlay).toBeTruthy();
    expect(overlay!.textContent).toContain("Your 14-day trial has ended");
  });

  it("expired overlay Buy License button calls openUrl", () => {
    useLicenseStore.setState({ state: "expired", daysRemaining: 0, loading: false });
    const { container } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    fireEvent.click(container.querySelector("[data-testid='expired-buy-license']")!);
    expect(openUrl).toHaveBeenCalledWith("https://lit.solar/buy");
  });

  it("expired overlay Enter License Key button opens LicenseEntryDialog", () => {
    useLicenseStore.setState({ state: "expired", daysRemaining: 0, loading: false });
    const { container, queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    fireEvent.click(container.querySelector("[data-testid='expired-enter-key']")!);
    expect(queryByTestId("license-entry-dialog")).toBeTruthy();
  });

  it("expired overlay Export My Data button is present", () => {
    useLicenseStore.setState({ state: "expired", daysRemaining: 0, loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("expired-export-data")).toBeTruthy();
  });

  it("calls fetchStatus on mount", () => {
    const fetchStatus = vi.fn();
    useLicenseStore.setState({ fetchStatus });
    render(<LicenseGate><div /></LicenseGate>);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("shows TrialBanner alongside children when expiring_soon", () => {
    useLicenseStore.setState({ state: "expiring_soon", daysRemaining: 2, loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("child")).toBeTruthy();
    expect(queryByTestId("trial-banner")).toBeTruthy();
  });
});

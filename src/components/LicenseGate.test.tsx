import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { mockInvoke } from "../test/tauri-mock";
import { LicenseGate } from "./LicenseGate";
import { useLicenseStore } from "../stores/license";
import type { LicenseState } from "../stores/license";

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
    // Default build-info mock so the async getBuildInfo() effect resolves to a
    // direct build (Buy button visible). Individual app_store tests override it.
    mockInvoke((cmd) => {
      if (cmd === "get_build_info") return { source: "direct" };
      return undefined;
    });
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

  it("shows revocation-specific splash and hides children when state is 'revoked'", () => {
    useLicenseStore.setState({ state: "revoked", licensedTo: null, loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("child")).toBeNull();
    const splash = queryByTestId("license-splash");
    expect(splash).toBeTruthy();
    // Distinct from the generic "requires a license" copy.
    expect(splash!.textContent).toMatch(/revoked/i);
    expect(splash!.textContent).not.toContain("Lit requires a license to continue.");
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

  it("hides Buy License button in app_store builds", async () => {
    // App Store Review Guideline 3.1.1: in-app affordances that send users to an
    // external purchase flow are forbidden. get_build_info reports the compile-time
    // distribution channel, independent of any license key's origin.
    mockInvoke((cmd) => {
      if (cmd === "get_build_info") return { source: "app_store" };
      return undefined;
    });
    useLicenseStore.setState({ state: "unlicensed", loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    // The other splash actions remain available regardless of channel.
    await waitFor(() => expect(queryByTestId("splash-enter-key")).toBeTruthy());
    await waitFor(() => expect(queryByTestId("splash-buy-license")).toBeNull());
    expect(queryByTestId("splash-enter-key")).toBeTruthy();
    expect(queryByTestId("splash-export-data")).toBeTruthy();
  });

  it("shows Buy License button in direct builds", async () => {
    mockInvoke((cmd) => {
      if (cmd === "get_build_info") return { source: "direct" };
      return undefined;
    });
    useLicenseStore.setState({ state: "unlicensed", loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    await waitFor(() => expect(queryByTestId("splash-buy-license")).toBeTruthy());
  });

  it("splash Enter License Key button opens LicenseEntryDialog", () => {
    useLicenseStore.setState({ state: "unlicensed", loading: false });
    const { container, queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    fireEvent.click(container.querySelector("[data-testid='splash-enter-key']")!);
    expect(queryByTestId("license-entry-dialog")).toBeTruthy();
  });

  it("menu-driven entryOpen prop opens the dialog while showing the splash", () => {
    useLicenseStore.setState({ state: "unlicensed", loading: false });
    const { queryByTestId } = render(
      <LicenseGate entryOpen onEntryOpenChange={vi.fn()}><div data-testid="child" /></LicenseGate>,
    );
    // Children are gated away during the splash, but the menu-driven dialog
    // (controlled via the entryOpen prop) is still in the DOM.
    expect(queryByTestId("child")).toBeNull();
    expect(queryByTestId("license-entry-dialog")).toBeTruthy();
  });

  it("splash Export My Data button is present", () => {
    useLicenseStore.setState({ state: "license_expired", loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("splash-export-data")).toBeTruthy();
  });

  it("hides children and shows splash for an unrecognized/stale state value", () => {
    useLicenseStore.setState({ state: "trial" as unknown as LicenseState, loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("child")).toBeNull();
    expect(queryByTestId("license-splash")).toBeTruthy();
  });

  it("does not render children when state is 'unknown' after loading completes", () => {
    useLicenseStore.setState({ state: "unknown", loading: false });
    const { queryByTestId } = render(
      <LicenseGate><div data-testid="child" /></LicenseGate>,
    );
    expect(queryByTestId("child")).toBeNull();
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

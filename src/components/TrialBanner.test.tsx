import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TrialBanner } from "./TrialBanner";
import { useLicenseStore } from "../stores/license";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

import { openUrl } from "@tauri-apps/plugin-opener";

describe("TrialBanner", () => {
  beforeEach(() => {
    useLicenseStore.setState({
      state: "unknown",
      daysRemaining: null,
      licensedTo: null,
      loading: false,
      error: null,
    });
  });

  it("renders nothing when state is 'licensed'", () => {
    useLicenseStore.setState({ state: "licensed" });
    const { container } = render(<TrialBanner onEnterKey={vi.fn()} />);
    expect(container.querySelector("[data-testid='trial-banner']")).toBeNull();
  });

  it("renders nothing when state is 'trial' with days > 3", () => {
    useLicenseStore.setState({ state: "trial", daysRemaining: 10 });
    const { container } = render(<TrialBanner onEnterKey={vi.fn()} />);
    expect(container.querySelector("[data-testid='trial-banner']")).toBeNull();
  });

  it("renders banner when state is 'expiring_soon'", () => {
    useLicenseStore.setState({ state: "expiring_soon", daysRemaining: 2 });
    const { container } = render(<TrialBanner onEnterKey={vi.fn()} />);
    const banner = container.querySelector("[data-testid='trial-banner']");
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain("2 days");
  });

  it("singular 'day' when daysRemaining is 1", () => {
    useLicenseStore.setState({ state: "expiring_soon", daysRemaining: 1 });
    const { container } = render(<TrialBanner onEnterKey={vi.fn()} />);
    const banner = container.querySelector("[data-testid='trial-banner']");
    expect(banner!.textContent).toContain("1 day");
    expect(banner!.textContent).not.toContain("1 days");
  });

  it("clicking Buy License calls openUrl", () => {
    useLicenseStore.setState({ state: "expiring_soon", daysRemaining: 2 });
    const { container } = render(<TrialBanner onEnterKey={vi.fn()} />);
    fireEvent.click(container.querySelector("[data-testid='trial-banner-buy']")!);
    expect(openUrl).toHaveBeenCalledWith("https://lit.solar/buy");
  });

  it("clicking Enter License Key calls onEnterKey prop", () => {
    useLicenseStore.setState({ state: "expiring_soon", daysRemaining: 2 });
    const onEnterKey = vi.fn();
    const { container } = render(<TrialBanner onEnterKey={onEnterKey} />);
    fireEvent.click(container.querySelector("[data-testid='trial-banner-enter-key']")!);
    expect(onEnterKey).toHaveBeenCalledTimes(1);
  });
});

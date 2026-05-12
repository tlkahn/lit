import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { LicenseInfoDialog } from "./LicenseInfoDialog";

describe("LicenseInfoDialog", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <LicenseInfoDialog open={false} licenseState="licensed" licensedTo="Alice" daysRemaining={null} onClose={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='license-info-dialog']")).toBeNull();
  });

  it("shows 'Licensed to {name}' when licensed", () => {
    const { getByTestId } = render(
      <LicenseInfoDialog open={true} licenseState="licensed" licensedTo="Alice" daysRemaining={null} onClose={vi.fn()} />,
    );
    expect(getByTestId("license-info-dialog").textContent).toContain("Licensed to Alice");
  });

  it("Close button calls onClose", () => {
    const onClose = vi.fn();
    const { getByTestId } = render(
      <LicenseInfoDialog open={true} licenseState="licensed" licensedTo="Alice" daysRemaining={null} onClose={onClose} />,
    );
    fireEvent.click(getByTestId("license-info-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape key calls onClose", () => {
    const onClose = vi.fn();
    render(<LicenseInfoDialog open={true} licenseState="licensed" licensedTo="Alice" daysRemaining={null} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows trial text with days remaining when in trial state", () => {
    const { getByTestId } = render(
      <LicenseInfoDialog open={true} licenseState="trial" licensedTo={null} daysRemaining={7} onClose={vi.fn()} />,
    );
    const text = getByTestId("license-info-dialog").textContent!;
    expect(text).toContain("Trial");
    expect(text).toContain("7 days remaining");
  });

  it("shows singular 'day' when 1 day remaining", () => {
    const { getByTestId } = render(
      <LicenseInfoDialog open={true} licenseState="trial" licensedTo={null} daysRemaining={1} onClose={vi.fn()} />,
    );
    expect(getByTestId("license-info-dialog").textContent).toContain("1 day remaining");
  });

  it("shows expired text when trial is expired", () => {
    const { getByTestId } = render(
      <LicenseInfoDialog open={true} licenseState="expired" licensedTo={null} daysRemaining={0} onClose={vi.fn()} />,
    );
    expect(getByTestId("license-info-dialog").textContent).toContain("Trial expired");
  });

  it("shows 'Licensed' fallback when licensed but licensedTo is null", () => {
    const { getByTestId } = render(
      <LicenseInfoDialog open={true} licenseState="licensed" licensedTo={null} daysRemaining={null} onClose={vi.fn()} />,
    );
    const text = getByTestId("license-info-dialog").textContent!;
    expect(text).toContain("Licensed");
    expect(text).not.toContain("Licensed to null");
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { LicenseInfoDialog } from "./LicenseInfoDialog";

describe("LicenseInfoDialog", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <LicenseInfoDialog open={false} licenseState="licensed" licensedTo="Alice" onClose={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='license-info-dialog']")).toBeNull();
  });

  it("shows 'Licensed to {name}' when licensed", () => {
    const { getByTestId } = render(
      <LicenseInfoDialog open={true} licenseState="licensed" licensedTo="Alice" onClose={vi.fn()} />,
    );
    expect(getByTestId("license-info-dialog").textContent).toContain("Licensed to Alice");
  });

  it("Close button calls onClose", () => {
    const onClose = vi.fn();
    const { getByTestId } = render(
      <LicenseInfoDialog open={true} licenseState="licensed" licensedTo="Alice" onClose={onClose} />,
    );
    fireEvent.click(getByTestId("license-info-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape key calls onClose", () => {
    const onClose = vi.fn();
    render(<LicenseInfoDialog open={true} licenseState="licensed" licensedTo="Alice" onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows 'License expired' when license_expired", () => {
    const { getByTestId } = render(
      <LicenseInfoDialog open={true} licenseState="license_expired" licensedTo="Alice" onClose={vi.fn()} />,
    );
    expect(getByTestId("license-info-dialog").textContent).toContain("License expired");
  });

  it("shows 'No license' when unlicensed", () => {
    const { getByTestId } = render(
      <LicenseInfoDialog open={true} licenseState="unlicensed" licensedTo={null} onClose={vi.fn()} />,
    );
    expect(getByTestId("license-info-dialog").textContent).toContain("No license");
  });

  it("shows 'Licensed' fallback when licensed but licensedTo is null", () => {
    const { getByTestId } = render(
      <LicenseInfoDialog open={true} licenseState="licensed" licensedTo={null} onClose={vi.fn()} />,
    );
    const text = getByTestId("license-info-dialog").textContent!;
    expect(text).toContain("Licensed");
    expect(text).not.toContain("Licensed to null");
  });
});

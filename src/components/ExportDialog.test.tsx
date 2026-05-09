import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ExportDialog } from "./ExportDialog";

describe("ExportDialog", () => {
  it("renders progress text", () => {
    const { container } = render(
      <ExportDialog visible={true} progress={{ current: 5, total: 20 }} result={null} />,
    );
    expect(container.textContent).toContain("5 / 20");
  });

  it("shows progress bar with correct value", () => {
    const { container } = render(
      <ExportDialog visible={true} progress={{ current: 5, total: 20 }} result={null} />,
    );
    const bar = container.querySelector("progress");
    expect(bar).toBeTruthy();
    expect(bar!.value).toBe(5);
    expect(bar!.max).toBe(20);
  });

  it("shows completion state", () => {
    const { container } = render(
      <ExportDialog visible={true} progress={null} result={{ exported_count: 42, destination: "/path/export.zip" }} />,
    );
    expect(container.textContent).toContain("Exported 42 files");
    expect(container.textContent).toContain("/path/export.zip");
  });

  it("hidden when not visible", () => {
    const { container } = render(
      <ExportDialog visible={false} progress={{ current: 5, total: 20 }} result={null} />,
    );
    expect(container.querySelector("[data-testid='export-dialog']")).toBeNull();
  });
});

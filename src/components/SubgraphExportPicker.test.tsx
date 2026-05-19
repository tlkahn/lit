import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SubgraphExportPicker } from "./SubgraphExportPicker";

describe("SubgraphExportPicker", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <SubgraphExportPicker open={false} onExport={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='subgraph-export-picker']")).toBeNull();
  });

  it("renders dialog when open=true", () => {
    const { container } = render(
      <SubgraphExportPicker open={true} onExport={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='subgraph-export-picker']")).toBeTruthy();
  });

  it("depth 1 is selected by default (aria-pressed)", () => {
    const { container } = render(
      <SubgraphExportPicker open={true} onExport={vi.fn()} onCancel={vi.fn()} />,
    );
    const btn1 = container.querySelector("[data-testid='export-depth-1']") as HTMLButtonElement;
    expect(btn1.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders Export and Cancel buttons", () => {
    const { container } = render(
      <SubgraphExportPicker open={true} onExport={vi.fn()} onCancel={vi.fn()} />,
    );
    const buttons = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toContain("Export");
    expect(buttons).toContain("Cancel");
  });

  it("shows 'Depth' label", () => {
    const { container } = render(
      <SubgraphExportPicker open={true} onExport={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.textContent).toContain("Depth");
  });
});

describe("SubgraphExportPicker interaction", () => {
  it("clicking depth 2 changes selection", () => {
    const { container } = render(
      <SubgraphExportPicker open={true} onExport={vi.fn()} onCancel={vi.fn()} />,
    );
    const btn2 = container.querySelector("[data-testid='export-depth-2']") as HTMLButtonElement;
    fireEvent.click(btn2);
    expect(btn2.getAttribute("aria-pressed")).toBe("true");
    const btn1 = container.querySelector("[data-testid='export-depth-1']") as HTMLButtonElement;
    expect(btn1.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking Export calls onExport with default depth (1)", () => {
    const onExport = vi.fn();
    const { container } = render(
      <SubgraphExportPicker open={true} onExport={onExport} onCancel={vi.fn()} />,
    );
    const exportBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Export",
    )!;
    fireEvent.click(exportBtn);
    expect(onExport).toHaveBeenCalledWith(1);
  });

  it("clicking Export after selecting depth 2 calls onExport(2)", () => {
    const onExport = vi.fn();
    const { container } = render(
      <SubgraphExportPicker open={true} onExport={onExport} onCancel={vi.fn()} />,
    );
    fireEvent.click(container.querySelector("[data-testid='export-depth-2']")!);
    const exportBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Export",
    )!;
    fireEvent.click(exportBtn);
    expect(onExport).toHaveBeenCalledWith(2);
  });

  it("clicking Cancel calls onCancel", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <SubgraphExportPicker open={true} onExport={vi.fn()} onCancel={onCancel} />,
    );
    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel",
    )!;
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalled();
  });

  it("Escape key calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <SubgraphExportPicker open={true} onExport={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("depth resets to 1 when dialog reopens", () => {
    const { container, rerender } = render(
      <SubgraphExportPicker open={true} onExport={vi.fn()} onCancel={vi.fn()} />,
    );
    fireEvent.click(container.querySelector("[data-testid='export-depth-3']")!);
    expect(
      (container.querySelector("[data-testid='export-depth-3']") as HTMLButtonElement).getAttribute("aria-pressed"),
    ).toBe("true");

    rerender(<SubgraphExportPicker open={false} onExport={vi.fn()} onCancel={vi.fn()} />);
    rerender(<SubgraphExportPicker open={true} onExport={vi.fn()} onCancel={vi.fn()} />);

    expect(
      (container.querySelector("[data-testid='export-depth-1']") as HTMLButtonElement).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

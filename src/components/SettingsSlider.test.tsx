import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SettingsSlider } from "./SettingsSlider";

describe("SettingsSlider", () => {
  it("renders range input with correct testId", () => {
    const { container } = render(
      <SettingsSlider value={0.5} onChange={vi.fn()} testId="test-sl" min={0} max={1} step={0.1} />,
    );
    const input = container.querySelector("[data-testid='test-sl']");
    expect(input).toBeTruthy();
    expect(input!.getAttribute("type")).toBe("range");
  });

  it("renders label text", () => {
    const { container } = render(
      <SettingsSlider value={0.5} onChange={vi.fn()} testId="test-sl" label="Temperature" min={0} max={1} step={0.1} />,
    );
    expect(container.textContent).toContain("Temperature");
  });

  it("reflects value prop", () => {
    const { container } = render(
      <SettingsSlider value={0.7} onChange={vi.fn()} testId="test-sl" min={0} max={2} step={0.1} />,
    );
    const input = container.querySelector("[data-testid='test-sl']") as HTMLInputElement;
    expect(input.value).toBe("0.7");
  });

  it("displays current value as text", () => {
    const { container } = render(
      <SettingsSlider value={0.7} onChange={vi.fn()} testId="test-sl" min={0} max={2} step={0.1} />,
    );
    const readout = container.querySelector("[data-testid='test-sl-value']");
    expect(readout).toBeTruthy();
    expect(readout!.textContent).toBe("0.7");
  });

  it("calls onChange when slider moves", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SettingsSlider value={0.5} onChange={onChange} testId="test-sl" min={0} max={2} step={0.1} />,
    );
    const input = container.querySelector("[data-testid='test-sl']")!;
    fireEvent.change(input, { target: { value: "1.2" } });
    expect(onChange).toHaveBeenCalledWith(1.2);
  });

  it("respects min/max/step", () => {
    const { container } = render(
      <SettingsSlider value={0.5} onChange={vi.fn()} testId="test-sl" min={0} max={2} step={0.1} />,
    );
    const input = container.querySelector("[data-testid='test-sl']") as HTMLInputElement;
    expect(input.min).toBe("0");
    expect(input.max).toBe("2");
    expect(input.step).toBe("0.1");
  });
});

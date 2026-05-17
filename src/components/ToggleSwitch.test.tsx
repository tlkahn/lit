import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ToggleSwitch } from "./ToggleSwitch";

describe("ToggleSwitch", () => {
  it("renders unchecked state", () => {
    const { container } = render(
      <ToggleSwitch checked={false} onChange={vi.fn()} testId="ts" />,
    );
    const btn = container.querySelector("[data-testid='ts']");
    expect(btn).toBeTruthy();
    expect(btn!.getAttribute("role")).toBe("switch");
    expect(btn!.getAttribute("aria-checked")).toBe("false");
  });

  it("renders checked state", () => {
    const { container } = render(
      <ToggleSwitch checked={true} onChange={vi.fn()} testId="ts" />,
    );
    const btn = container.querySelector("[data-testid='ts']");
    expect(btn!.getAttribute("aria-checked")).toBe("true");
  });

  it("calls onChange on click", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ToggleSwitch checked={false} onChange={onChange} testId="ts" />,
    );
    fireEvent.click(container.querySelector("[data-testid='ts']")!);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("renders label", () => {
    const { container } = render(
      <ToggleSwitch checked={false} onChange={vi.fn()} testId="ts" label="Dark Mode" />,
    );
    expect(container.textContent).toContain("Dark Mode");
  });

  it("renders JSX element as label", () => {
    const { container } = render(
      <ToggleSwitch checked={false} onChange={vi.fn()} testId="ts" label={<em>Highlighted</em>} />,
    );
    expect(container.querySelector("em")?.textContent).toBe("Highlighted");
  });

  it("renders label before toggle (label-left, control-right)", () => {
    const { container } = render(
      <ToggleSwitch checked={false} onChange={vi.fn()} testId="ts" label="Dark Mode" />,
    );
    const root = container.firstElementChild!;
    const label = root.querySelector("span.text-sm")!;
    const toggle = root.querySelector("[data-testid='ts']")!;
    const children = Array.from(root.children);
    expect(children.indexOf(label)).toBeLessThan(children.indexOf(toggle));
  });
});

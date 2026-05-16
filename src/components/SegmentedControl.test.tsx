import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SegmentedControl } from "./SegmentedControl";

describe("SegmentedControl", () => {
  const options = [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
  ];

  it("renders all option buttons", () => {
    const { container } = render(
      <SegmentedControl options={options} value="a" onChange={vi.fn()} testId="seg" />,
    );
    expect(container.querySelector("[data-testid='seg-a']")).toBeTruthy();
    expect(container.querySelector("[data-testid='seg-b']")).toBeTruthy();
  });

  it("marks active option with aria-pressed", () => {
    const { container } = render(
      <SegmentedControl options={options} value="a" onChange={vi.fn()} testId="seg" />,
    );
    expect(container.querySelector("[data-testid='seg-a']")!.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("[data-testid='seg-b']")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onChange on click", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SegmentedControl options={options} value="a" onChange={onChange} testId="seg" />,
    );
    fireEvent.click(container.querySelector("[data-testid='seg-b']")!);
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("renders label", () => {
    const { container } = render(
      <SegmentedControl options={options} value="a" onChange={vi.fn()} testId="seg" label="Pick one" />,
    );
    expect(container.textContent).toContain("Pick one");
  });

  it("renders JSX element as label", () => {
    const { container } = render(
      <SegmentedControl options={options} value="a" onChange={vi.fn()} testId="seg" label={<em>Highlighted</em>} />,
    );
    expect(container.querySelector("em")?.textContent).toBe("Highlighted");
  });
});

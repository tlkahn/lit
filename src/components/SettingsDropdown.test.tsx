import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SettingsDropdown } from "./SettingsDropdown";

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Charlie" },
];

describe("SettingsDropdown", () => {
  // Cycle 1.1 — Renders select with options
  it("renders a <select> with data-testid", () => {
    const { container } = render(
      <SettingsDropdown options={options} value="a" onChange={vi.fn()} testId="test-dropdown" />,
    );
    const select = container.querySelector("[data-testid='test-dropdown']");
    expect(select).toBeTruthy();
    expect(select!.tagName).toBe("SELECT");
  });

  it("renders all option elements with correct value and label", () => {
    const { container } = render(
      <SettingsDropdown options={options} value="a" onChange={vi.fn()} testId="test-dropdown" />,
    );
    const opts = container.querySelectorAll("option");
    expect(opts).toHaveLength(3);
    expect(opts[0]!.value).toBe("a");
    expect(opts[0]!.textContent).toBe("Alpha");
    expect(opts[1]!.value).toBe("b");
    expect(opts[1]!.textContent).toBe("Beta");
    expect(opts[2]!.value).toBe("c");
    expect(opts[2]!.textContent).toBe("Charlie");
  });

  // Cycle 1.2 — Selected value reflected
  it("reflects the selected value", () => {
    const { container } = render(
      <SettingsDropdown options={options} value="b" onChange={vi.fn()} testId="test-dropdown" />,
    );
    const select = container.querySelector("[data-testid='test-dropdown']") as HTMLSelectElement;
    expect(select.value).toBe("b");
  });

  // Cycle 1.3 — onChange fires on selection
  it("calls onChange when selection changes", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SettingsDropdown options={options} value="a" onChange={onChange} testId="test-dropdown" />,
    );
    const select = container.querySelector("[data-testid='test-dropdown']")!;
    fireEvent.change(select, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");
  });

  // Cycle 1.4 — Label rendering and layout
  it("renders label text", () => {
    const { container } = render(
      <SettingsDropdown options={options} value="a" onChange={vi.fn()} testId="test-dropdown" label="Pick one" />,
    );
    const span = container.querySelector("span.text-sm");
    expect(span).toBeTruthy();
    expect(span!.textContent).toBe("Pick one");
  });

  it("renders JSX label", () => {
    const { container } = render(
      <SettingsDropdown options={options} value="a" onChange={vi.fn()} testId="test-dropdown" label={<em>Fancy</em>} />,
    );
    const em = container.querySelector("em");
    expect(em).toBeTruthy();
    expect(em!.textContent).toBe("Fancy");
  });

  it("select element has no ad-hoc background/border Tailwind classes", () => {
    const { container } = render(
      <SettingsDropdown options={options} value="a" onChange={vi.fn()} testId="test-dropdown" />,
    );
    const select = container.querySelector("[data-testid='test-dropdown']")!;
    expect(select.className).not.toContain("bg-bg-tertiary");
    expect(select.className).not.toContain("rounded-md");
  });

  it("has label-left, control-right layout", () => {
    const { container } = render(
      <SettingsDropdown options={options} value="a" onChange={vi.fn()} testId="test-dropdown" label="Pick one" />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain("flex");
    expect(wrapper.className).toContain("items-center");
    expect(wrapper.className).toContain("justify-between");
    expect(wrapper.className).toContain("gap-2");
  });

  // Cycle 1.5 — Nullable "Default" option
  it("prepends Default option when nullable=true", () => {
    const { container } = render(
      <SettingsDropdown options={options} value="" onChange={vi.fn()} testId="test-dropdown" nullable />,
    );
    const opts = container.querySelectorAll("option");
    expect(opts).toHaveLength(4);
    expect(opts[0]!.value).toBe("");
    expect(opts[0]!.textContent).toBe("Default");
  });

  it("selecting Default fires onChange with empty string", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SettingsDropdown options={options} value="a" onChange={onChange} testId="test-dropdown" nullable />,
    );
    const select = container.querySelector("[data-testid='test-dropdown']")!;
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("");
  });
});

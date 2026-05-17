import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SettingsTextInput } from "./SettingsTextInput";

describe("SettingsTextInput", () => {
  it("renders with value", () => {
    const { container } = render(
      <SettingsTextInput value="en" onChange={vi.fn()} testId="txt" />,
    );
    const input = container.querySelector("[data-testid='txt']") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("en");
  });

  it("calls onChange on input", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SettingsTextInput value="en" onChange={onChange} testId="txt" />,
    );
    fireEvent.change(container.querySelector("[data-testid='txt']")!, {
      target: { value: "zh" },
    });
    expect(onChange).toHaveBeenCalledWith("zh");
  });

  it("renders label", () => {
    const { container } = render(
      <SettingsTextInput value="en" onChange={vi.fn()} testId="txt" label="Language" />,
    );
    expect(container.textContent).toContain("Language");
  });

  it("renders JSX element as label", () => {
    const { container } = render(
      <SettingsTextInput value="en" onChange={vi.fn()} testId="txt" label={<em>Highlighted</em>} />,
    );
    expect(container.querySelector("em")?.textContent).toBe("Highlighted");
  });

  it("calls onCommit on blur", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <SettingsTextInput value="en" onChange={vi.fn()} onCommit={onCommit} testId="txt" />,
    );
    fireEvent.blur(container.querySelector("[data-testid='txt']")!);
    expect(onCommit).toHaveBeenCalled();
  });

  it("does not throw when onCommit is omitted", () => {
    const { container } = render(
      <SettingsTextInput value="en" onChange={vi.fn()} testId="txt" />,
    );
    const input = container.querySelector("[data-testid='txt']")!;
    expect(() => {
      fireEvent.blur(input);
      fireEvent.keyDown(input, { key: "Enter" });
    }).not.toThrow();
  });

  it("calls onCommit on Enter", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <SettingsTextInput value="en" onChange={vi.fn()} onCommit={onCommit} testId="txt" />,
    );
    fireEvent.keyDown(container.querySelector("[data-testid='txt']")!, { key: "Enter" });
    expect(onCommit).toHaveBeenCalled();
  });

  it("renders label before input (label-left, control-right)", () => {
    const { container } = render(
      <SettingsTextInput value="en" onChange={vi.fn()} testId="txt" label="Language" />,
    );
    const root = container.firstElementChild!;
    const label = root.querySelector("span.text-sm")!;
    const input = root.querySelector("[data-testid='txt']")!;
    const children = Array.from(root.children);
    expect(children.indexOf(label)).toBeLessThan(children.indexOf(input));
  });
});

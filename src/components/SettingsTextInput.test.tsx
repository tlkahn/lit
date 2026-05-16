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

  it("calls onCommit on blur", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <SettingsTextInput value="en" onChange={vi.fn()} onCommit={onCommit} testId="txt" />,
    );
    fireEvent.blur(container.querySelector("[data-testid='txt']")!);
    expect(onCommit).toHaveBeenCalled();
  });

  it("calls onCommit on Enter", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <SettingsTextInput value="en" onChange={vi.fn()} onCommit={onCommit} testId="txt" />,
    );
    fireEvent.keyDown(container.querySelector("[data-testid='txt']")!, { key: "Enter" });
    expect(onCommit).toHaveBeenCalled();
  });
});

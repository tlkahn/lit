import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SettingsTextArea } from "./SettingsTextArea";

describe("SettingsTextArea", () => {
  it("renders textarea with correct testId", () => {
    const { container } = render(
      <SettingsTextArea value="" onChange={vi.fn()} testId="test-ta" />,
    );
    const ta = container.querySelector("[data-testid='test-ta']");
    expect(ta).toBeTruthy();
    expect(ta!.tagName).toBe("TEXTAREA");
  });

  it("renders label text", () => {
    const { container } = render(
      <SettingsTextArea value="" onChange={vi.fn()} testId="test-ta" label="System Prompt" />,
    );
    expect(container.textContent).toContain("System Prompt");
  });

  it("reflects value prop", () => {
    const { container } = render(
      <SettingsTextArea value="hello world" onChange={vi.fn()} testId="test-ta" />,
    );
    const ta = container.querySelector("[data-testid='test-ta']") as HTMLTextAreaElement;
    expect(ta.value).toBe("hello world");
  });

  it("calls onChange on input", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SettingsTextArea value="" onChange={onChange} testId="test-ta" />,
    );
    const ta = container.querySelector("[data-testid='test-ta']")!;
    fireEvent.change(ta, { target: { value: "new text" } });
    expect(onChange).toHaveBeenCalledWith("new text");
  });

  it("calls onCommit on blur", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <SettingsTextArea value="text" onChange={vi.fn()} testId="test-ta" onCommit={onCommit} />,
    );
    const ta = container.querySelector("[data-testid='test-ta']")!;
    fireEvent.blur(ta);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

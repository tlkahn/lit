import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SettingsPasswordInput } from "./SettingsPasswordInput";

describe("SettingsPasswordInput", () => {
  it("renders password input with correct testId", () => {
    const { container } = render(
      <SettingsPasswordInput testId="test-pw" hasKey={false} onSave={vi.fn()} onDelete={vi.fn()} />,
    );
    const input = container.querySelector("[data-testid='test-pw']");
    expect(input).toBeTruthy();
    expect(input!.getAttribute("type")).toBe("password");
  });

  it("renders label text", () => {
    const { container } = render(
      <SettingsPasswordInput testId="test-pw" label="API Key" hasKey={false} onSave={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container.textContent).toContain("API Key");
  });

  it("shows 'Key saved' indicator when hasKey is true", () => {
    const { container } = render(
      <SettingsPasswordInput testId="test-pw" hasKey={true} onSave={vi.fn()} onDelete={vi.fn()} />,
    );
    const badge = container.querySelector("[data-testid='test-pw-saved']");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toContain("Key saved");
  });

  it("hides indicator when hasKey is false", () => {
    const { container } = render(
      <SettingsPasswordInput testId="test-pw" hasKey={false} onSave={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='test-pw-saved']")).toBeNull();
  });

  it("calls onSave with entered value on Enter", () => {
    const onSave = vi.fn();
    const { container } = render(
      <SettingsPasswordInput testId="test-pw" hasKey={false} onSave={onSave} onDelete={vi.fn()} />,
    );
    const input = container.querySelector("[data-testid='test-pw']")!;
    fireEvent.change(input, { target: { value: "sk-123" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("sk-123");
  });

  it("calls onSave when Save button clicked", () => {
    const onSave = vi.fn();
    const { container } = render(
      <SettingsPasswordInput testId="test-pw" hasKey={false} onSave={onSave} onDelete={vi.fn()} />,
    );
    const input = container.querySelector("[data-testid='test-pw']")!;
    fireEvent.change(input, { target: { value: "sk-456" } });
    const saveBtn = container.querySelector("[data-testid='test-pw-save']")!;
    fireEvent.click(saveBtn);
    expect(onSave).toHaveBeenCalledWith("sk-456");
  });

  it("calls onDelete when clear button clicked", () => {
    const onDelete = vi.fn();
    const { container } = render(
      <SettingsPasswordInput testId="test-pw" hasKey={true} onSave={vi.fn()} onDelete={onDelete} />,
    );
    const clearBtn = container.querySelector("[data-testid='test-pw-clear']")!;
    fireEvent.click(clearBtn);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("clears input after save", () => {
    const { container } = render(
      <SettingsPasswordInput testId="test-pw" hasKey={false} onSave={vi.fn()} onDelete={vi.fn()} />,
    );
    const input = container.querySelector("[data-testid='test-pw']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-789" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("");
  });

  it("does not show clear button when hasKey is false", () => {
    const { container } = render(
      <SettingsPasswordInput testId="test-pw" hasKey={false} onSave={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container.querySelector("[data-testid='test-pw-clear']")).toBeNull();
  });
});

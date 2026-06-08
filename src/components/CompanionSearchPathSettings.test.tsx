import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { CompanionSearchPathSettings } from "./CompanionSearchPathSettings";
import { usePreferencesStore } from "../stores/preferences";
import * as prefs from "../stores/preferences";

beforeEach(() => {
  usePreferencesStore.setState({ companionSearchPath: [".", "pdfs"] });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("CompanionSearchPathSettings", () => {
  it("renders one input per configured path with current values", () => {
    const { container } = render(<CompanionSearchPathSettings />);
    const input0 = container.querySelector("[data-testid='companion-path-input-0']") as HTMLInputElement;
    const input1 = container.querySelector("[data-testid='companion-path-input-1']") as HTMLInputElement;
    expect(input0).toBeTruthy();
    expect(input1).toBeTruthy();
    expect(input0.value).toBe(".");
    expect(input1.value).toBe("pdfs");
  });

  it("editing a path input calls setCompanionSearchPath with the updated array", () => {
    const spy = vi.spyOn(prefs, "setCompanionSearchPath");
    const { container } = render(<CompanionSearchPathSettings />);
    const input1 = container.querySelector("[data-testid='companion-path-input-1']") as HTMLInputElement;
    fireEvent.change(input1, { target: { value: "papers" } });
    expect(spy).toHaveBeenCalledWith([".", "papers"]);
  });

  it("clicking Add appends an empty path and persists", () => {
    const spy = vi.spyOn(prefs, "setCompanionSearchPath");
    const { container } = render(<CompanionSearchPathSettings />);
    fireEvent.click(container.querySelector("[data-testid='companion-path-add']")!);
    expect(spy).toHaveBeenCalledWith([".", "pdfs", ""]);
  });

  it("clicking delete on a row removes that path and persists", () => {
    const spy = vi.spyOn(prefs, "setCompanionSearchPath");
    const { container } = render(<CompanionSearchPathSettings />);
    fireEvent.click(container.querySelector("[data-testid='companion-path-delete-1']")!);
    expect(spy).toHaveBeenCalledWith(["."]);
  });

  it("move up swaps a path with its predecessor and persists", () => {
    const spy = vi.spyOn(prefs, "setCompanionSearchPath");
    const { container } = render(<CompanionSearchPathSettings />);
    fireEvent.click(container.querySelector("[data-testid='companion-path-up-1']")!);
    expect(spy).toHaveBeenCalledWith(["pdfs", "."]);
  });

  it("move down swaps a path with its successor and persists", () => {
    const spy = vi.spyOn(prefs, "setCompanionSearchPath");
    const { container } = render(<CompanionSearchPathSettings />);
    fireEvent.click(container.querySelector("[data-testid='companion-path-down-0']")!);
    expect(spy).toHaveBeenCalledWith(["pdfs", "."]);
  });
});

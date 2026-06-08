import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
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

  it("typing a path does NOT persist on each keystroke (buffers locally)", () => {
    const spy = vi.spyOn(prefs, "setCompanionSearchPath");
    const { container } = render(<CompanionSearchPathSettings />);
    const input1 = container.querySelector("[data-testid='companion-path-input-1']") as HTMLInputElement;
    fireEvent.change(input1, { target: { value: "papers" } });
    expect(spy).not.toHaveBeenCalled();
    // local buffer reflects the typed value so the input stays responsive
    expect(input1.value).toBe("papers");
  });

  it("blurring a path input commits the buffered value", () => {
    const spy = vi.spyOn(prefs, "setCompanionSearchPath");
    const { container } = render(<CompanionSearchPathSettings />);
    const input1 = container.querySelector("[data-testid='companion-path-input-1']") as HTMLInputElement;
    fireEvent.change(input1, { target: { value: "papers" } });
    fireEvent.blur(input1);
    expect(spy).toHaveBeenCalledWith([".", "papers"]);
  });

  it("pressing Enter commits the buffered value", () => {
    const spy = vi.spyOn(prefs, "setCompanionSearchPath");
    const { container } = render(<CompanionSearchPathSettings />);
    const input1 = container.querySelector("[data-testid='companion-path-input-1']") as HTMLInputElement;
    fireEvent.change(input1, { target: { value: "papers" } });
    fireEvent.keyDown(input1, { key: "Enter" });
    expect(spy).toHaveBeenCalledWith([".", "papers"]);
  });

  it("syncs the local buffer when the store value changes externally", () => {
    const { container } = render(<CompanionSearchPathSettings />);
    const input1 = container.querySelector("[data-testid='companion-path-input-1']") as HTMLInputElement;
    fireEvent.change(input1, { target: { value: "scratch" } });
    act(() => {
      usePreferencesStore.setState({ companionSearchPath: ["x"] });
    });
    const input0 = container.querySelector("[data-testid='companion-path-input-0']") as HTMLInputElement;
    expect(input0.value).toBe("x");
  });

  it("clicking Add appends an empty row locally WITHOUT persisting", () => {
    const spy = vi.spyOn(prefs, "setCompanionSearchPath");
    const { container } = render(<CompanionSearchPathSettings />);
    fireEvent.click(container.querySelector("[data-testid='companion-path-add']")!);
    expect(spy).not.toHaveBeenCalled();
    // a new empty input row is present in local state
    expect(container.querySelector("[data-testid='companion-path-input-2']")).toBeTruthy();
  });

  it("filling the added row and blurring persists the trimmed value, dropping blanks", () => {
    const spy = vi.spyOn(prefs, "setCompanionSearchPath");
    const { container } = render(<CompanionSearchPathSettings />);
    fireEvent.click(container.querySelector("[data-testid='companion-path-add']")!);
    const input2 = container.querySelector("[data-testid='companion-path-input-2']") as HTMLInputElement;
    fireEvent.change(input2, { target: { value: "  papers  " } });
    fireEvent.blur(input2);
    expect(spy).toHaveBeenCalledWith([".", "pdfs", "papers"]);
  });

  it("committing a whitespace-only entry filters it out before persisting", () => {
    const spy = vi.spyOn(prefs, "setCompanionSearchPath");
    const { container } = render(<CompanionSearchPathSettings />);
    const input1 = container.querySelector("[data-testid='companion-path-input-1']") as HTMLInputElement;
    fireEvent.change(input1, { target: { value: "   " } });
    fireEvent.blur(input1);
    expect(spy).toHaveBeenCalledWith(["."]);
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

  it("reordering preserves input DOM identity per path (stable key)", () => {
    const { container } = render(<CompanionSearchPathSettings />);
    // Tag the "pdfs" input (index 1) with a sentinel attribute React does not control.
    const input1 = container.querySelector("[data-testid='companion-path-input-1']") as HTMLInputElement;
    expect(input1.value).toBe("pdfs");
    input1.setAttribute("data-sentinel", "X");
    // Move "pdfs" up to index 0.
    fireEvent.click(container.querySelector("[data-testid='companion-path-up-1']")!);
    // The node now at index 0 should be the SAME DOM node that held "pdfs":
    // its value is "pdfs" AND it still carries the sentinel attribute.
    const input0 = container.querySelector("[data-testid='companion-path-input-0']") as HTMLInputElement;
    expect(input0.value).toBe("pdfs");
    expect(input0.getAttribute("data-sentinel")).toBe("X");
  });
});

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { KeyChord } from "./KeyChord";

describe("KeyChord", () => {
  it("renders Mod-b with ⌘B on mac", () => {
    const { container } = render(<KeyChord chord="Mod-b" platform="mac" />);
    expect(container.textContent).toContain("⌘");
    expect(container.textContent).toContain("B");
  });

  it("renders Mod-Shift-k with each modifier/key in own <kbd> element", () => {
    const { container } = render(<KeyChord chord="Mod-Shift-k" platform="mac" />);
    const kbds = container.querySelectorAll("kbd");
    expect(kbds.length).toBe(3);
    expect(kbds[0]!.textContent).toBe("⌘");
    expect(kbds[1]!.textContent).toBe("⇧");
    expect(kbds[2]!.textContent).toBe("K");
  });

  it("renders multi-chord sequence with two groups", () => {
    const { container } = render(<KeyChord chord="Mod-k Mod-s" platform="mac" />);
    const kbds = container.querySelectorAll("kbd");
    expect(kbds.length).toBe(4);
    expect(container.textContent).toContain("⌘");
    expect(container.textContent).toContain("K");
    expect(container.textContent).toContain("S");
  });

  it("has data-testid='key-chord'", () => {
    const { container } = render(<KeyChord chord="Mod-b" platform="mac" />);
    expect(container.querySelector("[data-testid='key-chord']")).not.toBeNull();
  });

  it("renders with expected styling classes on kbd elements", () => {
    const { container } = render(<KeyChord chord="Mod-b" platform="mac" />);
    const kbd = container.querySelector("kbd")!;
    expect(kbd.className).toContain("rounded");
    expect(kbd.className).toContain("bg-bg-secondary");
    expect(kbd.className).toContain("border");
    expect(kbd.className).toContain("px-1");
    expect(kbd.className).toContain("text-xs");
    expect(kbd.className).toContain("font-mono");
  });

  it("renders muted placeholder for empty chord", () => {
    const { container } = render(<KeyChord chord="" platform="mac" />);
    expect(container.textContent).toBe("—");
    const span = container.querySelector("[data-testid='key-chord']")!;
    expect(span.className).toContain("text-text-muted");
  });

  it("renders with other platform format", () => {
    const { container } = render(<KeyChord chord="Mod-Shift-k" platform="other" />);
    const kbds = container.querySelectorAll("kbd");
    expect(kbds[0]!.textContent).toBe("Ctrl");
    expect(kbds[1]!.textContent).toBe("Shift");
    expect(kbds[2]!.textContent).toBe("K");
  });
});

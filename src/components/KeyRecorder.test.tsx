import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { KeyRecorder } from "./KeyRecorder";

describe("KeyRecorder", () => {
  describe("idle rendering", () => {
    it("renders with data-testid", () => {
      const { container } = render(<KeyRecorder platform="mac" />);
      expect(container.querySelector("[data-testid='key-recorder']")).not.toBeNull();
    });

    it("shows KeyChord for value prop", () => {
      const { container } = render(<KeyRecorder platform="mac" value="Mod-b" />);
      const chord = container.querySelector("[data-testid='key-chord']");
      expect(chord).not.toBeNull();
      expect(chord!.textContent).toContain("⌘");
    });

    it("shows dash when no value", () => {
      const { container } = render(<KeyRecorder platform="mac" />);
      expect(container.querySelector("[data-testid='key-recorder']")!.textContent).toBe("—");
    });

    it("has idle state attribute", () => {
      const { container } = render(<KeyRecorder platform="mac" />);
      expect(container.querySelector("[data-state='idle']")).not.toBeNull();
    });
  });

  describe("click enters recording", () => {
    it("transitions to recording state on click", () => {
      const { container } = render(<KeyRecorder platform="mac" />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      expect(recorder.getAttribute("data-state")).toBe("recording");
    });

    it("shows recording prompt text", () => {
      const { container } = render(<KeyRecorder platform="mac" />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      expect(recorder.textContent).toBe("Press a key combination…");
    });
  });

  describe("single chord capture", () => {
    it("captures Mod-b on mac", () => {
      const { container } = render(<KeyRecorder platform="mac" />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "b", metaKey: true });
      expect(recorder.getAttribute("data-state")).toBe("captured");
      const chord = recorder.querySelector("[data-testid='key-chord']");
      expect(chord).not.toBeNull();
    });

    it("captures Mod-b on other platform", () => {
      const { container } = render(<KeyRecorder platform="other" />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "b", ctrlKey: true });
      expect(recorder.getAttribute("data-state")).toBe("captured");
    });
  });

  describe("Escape cancels", () => {
    it("Escape in recording returns to idle", () => {
      const onCancel = vi.fn();
      const { container } = render(<KeyRecorder platform="mac" onCancel={onCancel} />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "Escape" });
      expect(recorder.getAttribute("data-state")).toBe("idle");
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("Escape in captured returns to idle and calls onCancel", () => {
      const onCancel = vi.fn();
      const { container } = render(<KeyRecorder platform="mac" onCancel={onCancel} />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "b", metaKey: true });
      expect(recorder.getAttribute("data-state")).toBe("captured");
      fireEvent.keyDown(recorder, { key: "Escape" });
      expect(recorder.getAttribute("data-state")).toBe("idle");
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("modified Escape in recording is captured, not cancelled", () => {
      const onCancel = vi.fn();
      const { container } = render(<KeyRecorder platform="mac" onCancel={onCancel} />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "Escape", metaKey: true });
      expect(recorder.getAttribute("data-state")).toBe("captured");
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("modified Escape in captured re-captures, not cancels", () => {
      const onCancel = vi.fn();
      const { container } = render(<KeyRecorder platform="mac" onCancel={onCancel} />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "b", metaKey: true });
      fireEvent.keyDown(recorder, { key: "Escape", shiftKey: true });
      expect(recorder.getAttribute("data-state")).toBe("captured");
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe("Enter confirms", () => {
    it("Enter in captured calls onConfirm with notation", () => {
      const onConfirm = vi.fn();
      const { container } = render(<KeyRecorder platform="mac" onConfirm={onConfirm} />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "b", metaKey: true });
      fireEvent.keyDown(recorder, { key: "Enter" });
      expect(recorder.getAttribute("data-state")).toBe("idle");
      expect(onConfirm).toHaveBeenCalledWith("Mod-b");
    });

    it("bare Enter in recording is not captured as a chord", () => {
      const onConfirm = vi.fn();
      const { container } = render(<KeyRecorder platform="mac" onConfirm={onConfirm} />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "Enter" });
      expect(recorder.getAttribute("data-state")).toBe("recording");
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("modified Enter IS capturable", () => {
      const onConfirm = vi.fn();
      const { container } = render(<KeyRecorder platform="mac" onConfirm={onConfirm} />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "Enter", metaKey: true });
      expect(recorder.getAttribute("data-state")).toBe("captured");
    });

    it("modified Enter in captured re-captures, not confirms", () => {
      const onConfirm = vi.fn();
      const { container } = render(<KeyRecorder platform="mac" onConfirm={onConfirm} />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "b", metaKey: true });
      fireEvent.keyDown(recorder, { key: "Enter", shiftKey: true });
      expect(recorder.getAttribute("data-state")).toBe("captured");
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("preventDefault during recording", () => {
    it("calls preventDefault on keydown in recording state", () => {
      const { container } = render(<KeyRecorder platform="mac" />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      const event = new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true });
      const spy = vi.spyOn(event, "preventDefault");
      recorder.dispatchEvent(event);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe("platform-aware display", () => {
    it("mac shows ⌘ symbol in captured state", () => {
      const { container } = render(<KeyRecorder platform="mac" />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "b", metaKey: true });
      expect(recorder.textContent).toContain("⌘");
    });

    it("other shows Ctrl in captured state", () => {
      const { container } = render(<KeyRecorder platform="other" />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "b", ctrlKey: true });
      expect(recorder.textContent).toContain("Ctrl");
    });
  });

  describe("modifier-only presses don't capture", () => {
    it("pressing Shift alone stays in recording", () => {
      const { container } = render(<KeyRecorder platform="mac" />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "Shift", shiftKey: true });
      expect(recorder.getAttribute("data-state")).toBe("recording");
    });

    it("pressing Meta alone stays in recording", () => {
      const { container } = render(<KeyRecorder platform="mac" />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "Meta", metaKey: true });
      expect(recorder.getAttribute("data-state")).toBe("recording");
    });

    it("pressing Control alone stays in recording", () => {
      const { container } = render(<KeyRecorder platform="mac" />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "Control", ctrlKey: true });
      expect(recorder.getAttribute("data-state")).toBe("recording");
    });
  });

  describe("re-capture in captured state", () => {
    it("pressing a new chord in captured state updates the capture", () => {
      const onConfirm = vi.fn();
      const { container } = render(<KeyRecorder platform="mac" onConfirm={onConfirm} />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "b", metaKey: true });
      expect(recorder.getAttribute("data-state")).toBe("captured");
      fireEvent.keyDown(recorder, { key: "k", metaKey: true, shiftKey: true });
      expect(recorder.getAttribute("data-state")).toBe("captured");
      fireEvent.keyDown(recorder, { key: "Enter" });
      expect(onConfirm).toHaveBeenCalledWith("Mod-Shift-k");
    });
  });

  describe("double-fire guard", () => {
    it("onConfirm is called at most once when Enter and blur fire consecutively", () => {
      const onConfirm = vi.fn();
      const { container } = render(<KeyRecorder platform="mac" onConfirm={onConfirm} />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "b", metaKey: true });
      // Confirm via Enter
      fireEvent.keyDown(recorder, { key: "Enter" });
      // Immediately blur (simulates focus moving after Enter)
      fireEvent.blur(recorder);
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith("Mod-b");
    });

    it("after a completed recording (Enter), clicking again to start a new session still works", () => {
      const onConfirm = vi.fn();
      const { container } = render(<KeyRecorder platform="mac" onConfirm={onConfirm} />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      // First session
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "b", metaKey: true });
      fireEvent.keyDown(recorder, { key: "Enter" });
      expect(onConfirm).toHaveBeenCalledTimes(1);
      // Start new session
      fireEvent.click(recorder);
      expect(recorder.getAttribute("data-state")).toBe("recording");
      fireEvent.keyDown(recorder, { key: "k", metaKey: true });
      fireEvent.blur(recorder);
      expect(onConfirm).toHaveBeenCalledTimes(2);
      expect(onConfirm).toHaveBeenLastCalledWith("Mod-k");
    });
  });

  describe("blur behavior", () => {
    it("blur in captured state calls onConfirm with captured notation", () => {
      const onConfirm = vi.fn();
      const { container } = render(<KeyRecorder platform="mac" onConfirm={onConfirm} />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      fireEvent.keyDown(recorder, { key: "b", metaKey: true });
      expect(recorder.getAttribute("data-state")).toBe("captured");
      fireEvent.blur(recorder);
      expect(onConfirm).toHaveBeenCalledWith("Mod-b");
    });

    it("blur in recording state with nothing captured calls onCancel", () => {
      const onCancel = vi.fn();
      const { container } = render(<KeyRecorder platform="mac" onCancel={onCancel} />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      fireEvent.click(recorder);
      expect(recorder.getAttribute("data-state")).toBe("recording");
      fireEvent.blur(recorder);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("blur in idle state does not call onConfirm or onCancel", () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      const { container } = render(<KeyRecorder platform="mac" onConfirm={onConfirm} onCancel={onCancel} />);
      const recorder = container.querySelector("[data-testid='key-recorder']")!;
      expect(recorder.getAttribute("data-state")).toBe("idle");
      fireEvent.blur(recorder);
      expect(onConfirm).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
    });
  });
});

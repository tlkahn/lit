import { describe, it, expect } from "vitest";
import { keyEventToNotation } from "./keyEventToNotation";

function fakeEvent(overrides: Partial<KeyboardEvent> = {}): Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"> {
  return {
    key: "a",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("keyEventToNotation", () => {
  describe("single letter keys", () => {
    it("returns lowercase letter", () => {
      expect(keyEventToNotation(fakeEvent({ key: "k" }), "mac")).toBe("k");
    });

    it("lowercases uppercase letters", () => {
      expect(keyEventToNotation(fakeEvent({ key: "K", shiftKey: true }), "mac")).toBe("Shift-k");
    });
  });

  describe("Mod key (platform-aware)", () => {
    it("mac: metaKey maps to Mod", () => {
      expect(keyEventToNotation(fakeEvent({ key: "k", metaKey: true }), "mac")).toBe("Mod-k");
    });

    it("mac: ctrlKey maps to Ctrl (not Mod)", () => {
      expect(keyEventToNotation(fakeEvent({ key: "k", ctrlKey: true }), "mac")).toBe("Ctrl-k");
    });

    it("other: ctrlKey maps to Mod", () => {
      expect(keyEventToNotation(fakeEvent({ key: "k", ctrlKey: true }), "other")).toBe("Mod-k");
    });

    it("other: metaKey is ignored", () => {
      expect(keyEventToNotation(fakeEvent({ key: "k", metaKey: true }), "other")).toBe("k");
    });
  });

  describe("multiple modifiers with ordering", () => {
    it("Ctrl-Mod ordering on mac (both ctrl and cmd)", () => {
      expect(
        keyEventToNotation(fakeEvent({ key: "k", ctrlKey: true, metaKey: true }), "mac"),
      ).toBe("Ctrl-Mod-k");
    });

    it("Mod-Shift ordering", () => {
      expect(
        keyEventToNotation(fakeEvent({ key: "k", metaKey: true, shiftKey: true }), "mac"),
      ).toBe("Mod-Shift-k");
    });

    it("Mod-Alt ordering", () => {
      expect(
        keyEventToNotation(fakeEvent({ key: "k", metaKey: true, altKey: true }), "mac"),
      ).toBe("Mod-Alt-k");
    });

    it("all modifiers on mac", () => {
      expect(
        keyEventToNotation(
          fakeEvent({ key: "k", ctrlKey: true, metaKey: true, shiftKey: true, altKey: true }),
          "mac",
        ),
      ).toBe("Ctrl-Mod-Shift-Alt-k");
    });

    it("Mod-Shift on other platform", () => {
      expect(
        keyEventToNotation(fakeEvent({ key: "k", ctrlKey: true, shiftKey: true }), "other"),
      ).toBe("Mod-Shift-k");
    });
  });

  describe("special keys", () => {
    it("Enter", () => {
      expect(keyEventToNotation(fakeEvent({ key: "Enter" }), "mac")).toBe("Enter");
    });

    it("Escape", () => {
      expect(keyEventToNotation(fakeEvent({ key: "Escape" }), "mac")).toBe("Escape");
    });

    it("Tab", () => {
      expect(keyEventToNotation(fakeEvent({ key: "Tab" }), "mac")).toBe("Tab");
    });

    it("ArrowUp", () => {
      expect(keyEventToNotation(fakeEvent({ key: "ArrowUp" }), "mac")).toBe("ArrowUp");
    });

    it("Backspace", () => {
      expect(keyEventToNotation(fakeEvent({ key: "Backspace" }), "mac")).toBe("Backspace");
    });

    it("Space", () => {
      expect(keyEventToNotation(fakeEvent({ key: " " }), "mac")).toBe("Space");
    });

    it("Mod-Space", () => {
      expect(keyEventToNotation(fakeEvent({ key: " ", metaKey: true }), "mac")).toBe("Mod-Space");
    });

    it("F1", () => {
      expect(keyEventToNotation(fakeEvent({ key: "F1" }), "mac")).toBe("F1");
    });

    it("Delete", () => {
      expect(keyEventToNotation(fakeEvent({ key: "Delete" }), "mac")).toBe("Delete");
    });

    it("modified special keys", () => {
      expect(keyEventToNotation(fakeEvent({ key: "Enter", metaKey: true }), "mac")).toBe("Mod-Enter");
      expect(keyEventToNotation(fakeEvent({ key: "Escape", shiftKey: true }), "mac")).toBe("Shift-Escape");
    });
  });

  describe("modifier-only press returns null", () => {
    it("Shift only", () => {
      expect(keyEventToNotation(fakeEvent({ key: "Shift", shiftKey: true }), "mac")).toBeNull();
    });

    it("Meta only", () => {
      expect(keyEventToNotation(fakeEvent({ key: "Meta", metaKey: true }), "mac")).toBeNull();
    });

    it("Control only", () => {
      expect(keyEventToNotation(fakeEvent({ key: "Control", ctrlKey: true }), "mac")).toBeNull();
    });

    it("Alt only", () => {
      expect(keyEventToNotation(fakeEvent({ key: "Alt", altKey: true }), "mac")).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("digit keys", () => {
      expect(keyEventToNotation(fakeEvent({ key: "1" }), "mac")).toBe("1");
      expect(keyEventToNotation(fakeEvent({ key: "1", metaKey: true }), "mac")).toBe("Mod-1");
    });

    it("minus key with modifiers", () => {
      expect(keyEventToNotation(fakeEvent({ key: "-", metaKey: true }), "mac")).toBe("Mod--");
    });

    it("punctuation", () => {
      expect(keyEventToNotation(fakeEvent({ key: "[", metaKey: true }), "mac")).toBe("Mod-[");
      expect(keyEventToNotation(fakeEvent({ key: "\\", metaKey: true }), "mac")).toBe("Mod-\\");
    });
  });
});

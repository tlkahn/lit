import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlphabetStrip } from "./AlphabetStrip";

describe("AlphabetStrip", () => {
  it("renders all 27 letters (A-Z plus #)", () => {
    render(
      <AlphabetStrip
        letterSet={new Set(["A"])}
        activeLetter=""
        onLetterClick={() => {}}
      />,
    );
    const letters = screen.getAllByTestId("alphabet-letter");
    expect(letters).toHaveLength(27);
    expect(letters[0]!.getAttribute("data-letter")).toBe("A");
    expect(letters[25]!.getAttribute("data-letter")).toBe("Z");
    expect(letters[26]!.getAttribute("data-letter")).toBe("#");
  });

  it("letters in letterSet are enabled, others are disabled", () => {
    render(
      <AlphabetStrip
        letterSet={new Set(["A", "M", "#"])}
        activeLetter=""
        onLetterClick={() => {}}
      />,
    );
    const letters = screen.getAllByTestId("alphabet-letter");
    const enabled = letters.filter((el) => !(el as HTMLButtonElement).disabled);
    const enabledLetters = enabled.map((el) => el.getAttribute("data-letter"));
    expect(enabledLetters).toEqual(["A", "M", "#"]);

    const disabled = letters.filter((el) => (el as HTMLButtonElement).disabled);
    expect(disabled).toHaveLength(24);
  });

  it("active letter gets bold and accent classes", () => {
    render(
      <AlphabetStrip
        letterSet={new Set(["A", "M"])}
        activeLetter="M"
        onLetterClick={() => {}}
      />,
    );
    const mButton = screen
      .getAllByTestId("alphabet-letter")
      .find((el) => el.getAttribute("data-letter") === "M")!;
    expect(mButton.className).toContain("font-bold");
    expect(mButton.className).toContain("text-interactive-accent");
  });

  it("clicking an enabled letter calls onLetterClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <AlphabetStrip
        letterSet={new Set(["A", "F"])}
        activeLetter=""
        onLetterClick={onClick}
      />,
    );
    const aButton = screen
      .getAllByTestId("alphabet-letter")
      .find((el) => el.getAttribute("data-letter") === "A")!;
    await user.click(aButton);
    expect(onClick).toHaveBeenCalledWith("A");
  });

  it("clicking a disabled letter does NOT call onLetterClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <AlphabetStrip
        letterSet={new Set(["A"])}
        activeLetter=""
        onLetterClick={onClick}
      />,
    );
    const bButton = screen
      .getAllByTestId("alphabet-letter")
      .find((el) => el.getAttribute("data-letter") === "B")!;
    await user.click(bButton);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("has data-testid='alphabet-strip' on the outer container", () => {
    render(
      <AlphabetStrip
        letterSet={new Set(["A"])}
        activeLetter=""
        onLetterClick={() => {}}
      />,
    );
    expect(screen.getByTestId("alphabet-strip")).toBeInTheDocument();
  });

  describe("ARIA and accessibility", () => {
    it("strip has role=navigation and aria-label", () => {
      render(
        <AlphabetStrip
          letterSet={new Set(["A"])}
          activeLetter=""
          onLetterClick={() => {}}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      expect(strip.getAttribute("role")).toBe("navigation");
      expect(strip.getAttribute("aria-label")).toBe("Alphabetical index");
    });

    it("letter buttons have aria-label", () => {
      render(
        <AlphabetStrip
          letterSet={new Set(["A", "M"])}
          activeLetter=""
          onLetterClick={() => {}}
        />,
      );
      const aButton = screen
        .getAllByTestId("alphabet-letter")
        .find((el) => el.getAttribute("data-letter") === "A")!;
      expect(aButton.getAttribute("aria-label")).toBe("Jump to section A");
      const hashButton = screen
        .getAllByTestId("alphabet-letter")
        .find((el) => el.getAttribute("data-letter") === "#")!;
      expect(hashButton.getAttribute("aria-label")).toBe("Jump to section #");
    });

    it("strip is focusable via tabIndex", () => {
      render(
        <AlphabetStrip
          letterSet={new Set(["A"])}
          activeLetter=""
          onLetterClick={() => {}}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      expect(strip.getAttribute("tabindex")).toBe("0");
    });
  });

  describe("keyboard navigation", () => {
    it("ArrowDown moves focus to next letter", () => {
      render(
        <AlphabetStrip
          letterSet={new Set(["A", "B"])}
          activeLetter=""
          onLetterClick={() => {}}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      fireEvent.focus(strip);
      const letters = screen.getAllByTestId("alphabet-letter");
      expect(letters[0]!.className).toContain("ring-1");

      fireEvent.keyDown(strip, { key: "ArrowDown" });
      const lettersAfter = screen.getAllByTestId("alphabet-letter");
      expect(lettersAfter[0]!.className).not.toContain("ring-1");
      expect(lettersAfter[1]!.className).toContain("ring-1");
    });

    it("ArrowUp moves focus to previous letter", () => {
      render(
        <AlphabetStrip
          letterSet={new Set(["A", "B"])}
          activeLetter=""
          onLetterClick={() => {}}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      fireEvent.focus(strip);
      fireEvent.keyDown(strip, { key: "ArrowDown" });
      fireEvent.keyDown(strip, { key: "ArrowUp" });
      const letters = screen.getAllByTestId("alphabet-letter");
      expect(letters[0]!.className).toContain("ring-1");
    });

    it("ArrowDown does not go past last letter", () => {
      render(
        <AlphabetStrip
          letterSet={new Set(["#"])}
          activeLetter=""
          onLetterClick={() => {}}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      fireEvent.focus(strip);
      for (let i = 0; i < 30; i++) fireEvent.keyDown(strip, { key: "ArrowDown" });
      const letters = screen.getAllByTestId("alphabet-letter");
      expect(letters[26]!.className).toContain("ring-1");
    });

    it("ArrowUp does not go past first letter", () => {
      render(
        <AlphabetStrip
          letterSet={new Set(["A"])}
          activeLetter=""
          onLetterClick={() => {}}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      fireEvent.focus(strip);
      fireEvent.keyDown(strip, { key: "ArrowUp" });
      const letters = screen.getAllByTestId("alphabet-letter");
      expect(letters[0]!.className).toContain("ring-1");
    });

    it("Enter activates an available letter", () => {
      const onClick = vi.fn();
      render(
        <AlphabetStrip
          letterSet={new Set(["A", "B"])}
          activeLetter=""
          onLetterClick={onClick}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      fireEvent.focus(strip);
      fireEvent.keyDown(strip, { key: "Enter" });
      expect(onClick).toHaveBeenCalledWith("A");
    });

    it("Space activates an available letter", () => {
      const onClick = vi.fn();
      render(
        <AlphabetStrip
          letterSet={new Set(["A", "B"])}
          activeLetter=""
          onLetterClick={onClick}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      fireEvent.focus(strip);
      fireEvent.keyDown(strip, { key: " " });
      expect(onClick).toHaveBeenCalledWith("A");
    });

    it("Enter on a disabled letter does not call onLetterClick", () => {
      const onClick = vi.fn();
      render(
        <AlphabetStrip
          letterSet={new Set(["B"])}
          activeLetter=""
          onLetterClick={onClick}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      fireEvent.focus(strip);
      fireEvent.keyDown(strip, { key: "Enter" });
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe("visibility", () => {
    it("renders nothing when visible is false", () => {
      render(
        <AlphabetStrip
          letterSet={new Set(["A"])}
          activeLetter=""
          onLetterClick={() => {}}
          visible={false}
        />,
      );
      expect(screen.queryByTestId("alphabet-strip")).not.toBeInTheDocument();
    });

    it("renders when visible is true", () => {
      render(
        <AlphabetStrip
          letterSet={new Set(["A"])}
          activeLetter=""
          onLetterClick={() => {}}
          visible={true}
        />,
      );
      expect(screen.getByTestId("alphabet-strip")).toBeInTheDocument();
    });

    it("renders by default when visible prop is omitted", () => {
      render(
        <AlphabetStrip
          letterSet={new Set(["A"])}
          activeLetter=""
          onLetterClick={() => {}}
        />,
      );
      expect(screen.getByTestId("alphabet-strip")).toBeInTheDocument();
    });
  });

  it("active letter not in letterSet is disabled and not highlighted", () => {
    render(
      <AlphabetStrip
        letterSet={new Set(["A"])}
        activeLetter="Q"
        onLetterClick={() => {}}
      />,
    );
    const qButton = screen
      .getAllByTestId("alphabet-letter")
      .find((el) => el.getAttribute("data-letter") === "Q")!;
    expect((qButton as HTMLButtonElement).disabled).toBe(true);
    expect(qButton.className).not.toContain("font-bold");
    expect(qButton.className).not.toContain("text-interactive-accent");
  });

  describe("drag interaction", () => {
    function mockStripRect(strip: HTMLElement, letterHeight = 16) {
      vi.spyOn(strip, "getBoundingClientRect").mockReturnValue({
        top: 0,
        left: 0,
        bottom: 27 * letterHeight,
        right: 16,
        width: 16,
        height: 27 * letterHeight,
        x: 0,
        y: 0,
        toJSON: () => {},
      });
    }

    function mockPointerCapture(strip: HTMLElement) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom lacks PointerEvent APIs
      const el = strip as Record<string, any>;
      el.setPointerCapture = vi.fn();
      el.releasePointerCapture = vi.fn();
    }

    function pointerEvent(type: string, init: { clientY: number; pointerId?: number }): Event {
      const e = new MouseEvent(type, { clientY: init.clientY, bubbles: true });
      Object.defineProperty(e, "pointerId", { value: init.pointerId ?? 0 });
      return e;
    }

    it("onPointerDown + onPointerMove calls onLetterDrag (not onLetterClick)", () => {
      const onClick = vi.fn();
      const onDrag = vi.fn();
      render(
        <AlphabetStrip
          letterSet={new Set(["A", "M", "Z"])}
          activeLetter=""
          onLetterClick={onClick}
          onLetterDrag={onDrag}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      mockStripRect(strip);
      mockPointerCapture(strip);

      fireEvent(strip, pointerEvent("pointerdown", { clientY: 0, pointerId: 1 }));
      fireEvent(strip, pointerEvent("pointermove", { clientY: 12 * 16 + 8, pointerId: 1 }));

      expect(onDrag).toHaveBeenCalledWith("M");
      expect(onClick).not.toHaveBeenCalled();
    });

    it("drag snaps to nearest available letter when over a disabled letter", () => {
      const onDrag = vi.fn();
      render(
        <AlphabetStrip
          letterSet={new Set(["A", "M"])}
          activeLetter=""
          onLetterClick={() => {}}
          onLetterDrag={onDrag}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      mockStripRect(strip);
      mockPointerCapture(strip);

      fireEvent(strip, pointerEvent("pointerdown", { clientY: 0, pointerId: 1 }));
      fireEvent(strip, pointerEvent("pointermove", { clientY: 1 * 16 + 8, pointerId: 1 }));

      expect(onDrag).toHaveBeenCalledWith("A");
    });

    it("drag does not re-fire callback when pointer stays on same letter", () => {
      const onDrag = vi.fn();
      render(
        <AlphabetStrip
          letterSet={new Set(["M"])}
          activeLetter=""
          onLetterClick={() => {}}
          onLetterDrag={onDrag}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      mockStripRect(strip);
      mockPointerCapture(strip);

      fireEvent(strip, pointerEvent("pointerdown", { clientY: 0, pointerId: 1 }));
      fireEvent(strip, pointerEvent("pointermove", { clientY: 12 * 16 + 2, pointerId: 1 }));
      fireEvent(strip, pointerEvent("pointermove", { clientY: 12 * 16 + 10, pointerId: 1 }));

      expect(onDrag).toHaveBeenCalledTimes(1);
    });

    it("floating indicator appears during drag", () => {
      render(
        <AlphabetStrip
          letterSet={new Set(["A", "M"])}
          activeLetter=""
          onLetterClick={() => {}}
          onLetterDrag={() => {}}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      mockStripRect(strip);
      mockPointerCapture(strip);

      expect(screen.queryByTestId("alphabet-float-indicator")).not.toBeInTheDocument();

      fireEvent(strip, pointerEvent("pointerdown", { clientY: 0, pointerId: 1 }));
      fireEvent(strip, pointerEvent("pointermove", { clientY: 12 * 16 + 8, pointerId: 1 }));

      const indicator = screen.getByTestId("alphabet-float-indicator");
      expect(indicator).toBeInTheDocument();
      expect(indicator.textContent).toBe("M");
    });

    it("floating indicator disappears on pointerUp", () => {
      render(
        <AlphabetStrip
          letterSet={new Set(["A", "M"])}
          activeLetter=""
          onLetterClick={() => {}}
          onLetterDrag={() => {}}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      mockStripRect(strip);
      mockPointerCapture(strip);

      fireEvent(strip, pointerEvent("pointerdown", { clientY: 0, pointerId: 1 }));
      fireEvent(strip, pointerEvent("pointermove", { clientY: 12 * 16 + 8, pointerId: 1 }));
      expect(screen.getByTestId("alphabet-float-indicator")).toBeInTheDocument();

      fireEvent(strip, pointerEvent("pointerup", { clientY: 12 * 16 + 8, pointerId: 1 }));
      expect(screen.queryByTestId("alphabet-float-indicator")).not.toBeInTheDocument();
    });

    it("floating indicator disappears on pointerCancel", () => {
      render(
        <AlphabetStrip
          letterSet={new Set(["A", "M"])}
          activeLetter=""
          onLetterClick={() => {}}
          onLetterDrag={() => {}}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      mockStripRect(strip);
      mockPointerCapture(strip);

      fireEvent(strip, pointerEvent("pointerdown", { clientY: 0, pointerId: 1 }));
      fireEvent(strip, pointerEvent("pointermove", { clientY: 12 * 16 + 8, pointerId: 1 }));
      expect(screen.getByTestId("alphabet-float-indicator")).toBeInTheDocument();

      fireEvent(strip, pointerEvent("pointercancel", { clientY: 0, pointerId: 1 }));
      expect(screen.queryByTestId("alphabet-float-indicator")).not.toBeInTheDocument();
    });

    it("tap (no pointer move) still calls onLetterClick via button click", async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      const onDrag = vi.fn();
      render(
        <AlphabetStrip
          letterSet={new Set(["A", "M"])}
          activeLetter=""
          onLetterClick={onClick}
          onLetterDrag={onDrag}
        />,
      );

      const aButton = screen
        .getAllByTestId("alphabet-letter")
        .find((el) => el.getAttribute("data-letter") === "A")!;
      await user.click(aButton);

      expect(onClick).toHaveBeenCalledWith("A");
      expect(onDrag).not.toHaveBeenCalled();
    });

    it("click after drag is suppressed", () => {
      const onClick = vi.fn();
      const onDrag = vi.fn();
      render(
        <AlphabetStrip
          letterSet={new Set(["A", "M"])}
          activeLetter=""
          onLetterClick={onClick}
          onLetterDrag={onDrag}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      mockStripRect(strip);
      mockPointerCapture(strip);

      fireEvent(strip, pointerEvent("pointerdown", { clientY: 0, pointerId: 1 }));
      fireEvent(strip, pointerEvent("pointermove", { clientY: 12 * 16 + 8, pointerId: 1 }));
      fireEvent(strip, pointerEvent("pointerup", { clientY: 12 * 16 + 8, pointerId: 1 }));

      const aButton = screen
        .getAllByTestId("alphabet-letter")
        .find((el) => el.getAttribute("data-letter") === "A")!;
      fireEvent.click(aButton);

      expect(onClick).not.toHaveBeenCalled();
    });

    it("setPointerCapture is called on pointerDown", () => {
      render(
        <AlphabetStrip
          letterSet={new Set(["A"])}
          activeLetter=""
          onLetterClick={() => {}}
          onLetterDrag={() => {}}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      mockStripRect(strip);
      mockPointerCapture(strip);

      fireEvent(strip, pointerEvent("pointerdown", { clientY: 0, pointerId: 42 }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom lacks PointerEvent APIs
      expect((strip as Record<string, any>).setPointerCapture).toHaveBeenCalledWith(42);
    });

    it("falls back to onLetterClick for drag when onLetterDrag not provided", () => {
      const onClick = vi.fn();
      render(
        <AlphabetStrip
          letterSet={new Set(["A", "M"])}
          activeLetter=""
          onLetterClick={onClick}
        />,
      );
      const strip = screen.getByTestId("alphabet-strip");
      mockStripRect(strip);
      mockPointerCapture(strip);

      fireEvent(strip, pointerEvent("pointerdown", { clientY: 0, pointerId: 1 }));
      fireEvent(strip, pointerEvent("pointermove", { clientY: 12 * 16 + 8, pointerId: 1 }));

      expect(onClick).toHaveBeenCalledWith("M");
    });
  });
});

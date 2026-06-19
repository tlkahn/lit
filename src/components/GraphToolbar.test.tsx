import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GraphToolbar } from "./GraphToolbar";

describe("GraphToolbar", () => {
  const defaults = {
    mode: "full" as const,
    depth: 2,
    onModeChange: vi.fn(),
    onDepthChange: vi.fn(),
    onResetZoom: vi.fn(),
  };

  describe("mode toggle", () => {
    it("renders Full and Local buttons", () => {
      render(<GraphToolbar {...defaults} />);
      expect(screen.getByRole("button", { name: "Full" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Local" })).toBeTruthy();
    });

    it("active mode button has aria-pressed=true", () => {
      render(<GraphToolbar {...defaults} mode="full" />);
      expect(screen.getByRole("button", { name: "Full" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: "Local" }).getAttribute("aria-pressed")).toBe("false");
    });

    it("clicking Local calls onModeChange('local')", async () => {
      const onModeChange = vi.fn();
      render(<GraphToolbar {...defaults} onModeChange={onModeChange} />);
      await userEvent.click(screen.getByRole("button", { name: "Local" }));
      expect(onModeChange).toHaveBeenCalledWith("local");
    });

    it("clicking Full calls onModeChange('full')", async () => {
      const onModeChange = vi.fn();
      render(<GraphToolbar {...defaults} mode="local" onModeChange={onModeChange} />);
      await userEvent.click(screen.getByRole("button", { name: "Full" }));
      expect(onModeChange).toHaveBeenCalledWith("full");
    });
  });

  describe("localDisabled", () => {
    it("Local button is disabled when localDisabled=true", () => {
      render(<GraphToolbar {...defaults} localDisabled={true} />);
      expect(screen.getByRole("button", { name: "Local" })).toBeDisabled();
    });

    it("clicking disabled Local button does not call onModeChange", async () => {
      const onModeChange = vi.fn();
      render(<GraphToolbar {...defaults} localDisabled={true} onModeChange={onModeChange} />);
      await userEvent.click(screen.getByRole("button", { name: "Local" }));
      expect(onModeChange).not.toHaveBeenCalled();
    });

    it("Local button is enabled when localDisabled=false", () => {
      render(<GraphToolbar {...defaults} localDisabled={false} />);
      expect(screen.getByRole("button", { name: "Local" })).not.toBeDisabled();
    });
  });

  describe("depth controls", () => {
    it("depth buttons are NOT rendered when mode=full", () => {
      render(<GraphToolbar {...defaults} mode="full" />);
      expect(screen.queryByRole("button", { name: "1" })).toBeNull();
      expect(screen.queryByRole("button", { name: "2" })).toBeNull();
      expect(screen.queryByRole("button", { name: "3" })).toBeNull();
    });

    it("depth buttons ARE rendered when mode=local", () => {
      render(<GraphToolbar {...defaults} mode="local" />);
      expect(screen.getByRole("button", { name: "1" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "2" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "3" })).toBeTruthy();
    });

    it("active depth button has aria-pressed=true", () => {
      render(<GraphToolbar {...defaults} mode="local" depth={2} />);
      expect(screen.getByRole("button", { name: "2" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: "1" }).getAttribute("aria-pressed")).toBe("false");
    });

    it("clicking depth 3 calls onDepthChange(3)", async () => {
      const onDepthChange = vi.fn();
      render(<GraphToolbar {...defaults} mode="local" onDepthChange={onDepthChange} />);
      await userEvent.click(screen.getByRole("button", { name: "3" }));
      expect(onDepthChange).toHaveBeenCalledWith(3);
    });
  });

  describe("reset zoom", () => {
    it("reset zoom button is always rendered", () => {
      render(<GraphToolbar {...defaults} mode="full" />);
      expect(screen.getByRole("button", { name: "Reset zoom" })).toBeTruthy();
    });

    it("clicking reset zoom calls onResetZoom", async () => {
      const onResetZoom = vi.fn();
      render(<GraphToolbar {...defaults} onResetZoom={onResetZoom} />);
      await userEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
      expect(onResetZoom).toHaveBeenCalledTimes(1);
    });
  });

  describe("search button", () => {
    it("renders a search button with aria-label 'Search graph'", () => {
      render(<GraphToolbar {...defaults} onSearch={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Search graph" })).toBeTruthy();
    });

    it("clicking search button calls onSearch", async () => {
      const onSearch = vi.fn();
      render(<GraphToolbar {...defaults} onSearch={onSearch} />);
      await userEvent.click(screen.getByRole("button", { name: "Search graph" }));
      expect(onSearch).toHaveBeenCalledTimes(1);
    });
  });

  describe("show citations toggle", () => {
    it("renders Show citations button when onShowCitationsChange provided", () => {
      render(<GraphToolbar {...defaults} onShowCitationsChange={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Show citations" })).toBeTruthy();
    });

    it("Show citations button not rendered when onShowCitationsChange is undefined", () => {
      render(<GraphToolbar {...defaults} />);
      expect(screen.queryByRole("button", { name: "Show citations" })).toBeNull();
    });

    it("Show citations button has aria-pressed=true when showCitations=true", () => {
      render(<GraphToolbar {...defaults} showCitations={true} onShowCitationsChange={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Show citations" }).getAttribute("aria-pressed")).toBe("true");
    });

    it("Show citations button has aria-pressed=false when showCitations=false", () => {
      render(<GraphToolbar {...defaults} showCitations={false} onShowCitationsChange={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Show citations" }).getAttribute("aria-pressed")).toBe("false");
    });

    it("clicking Show citations toggles via onShowCitationsChange", async () => {
      const onShowCitationsChange = vi.fn();
      render(<GraphToolbar {...defaults} showCitations={false} onShowCitationsChange={onShowCitationsChange} />);
      await userEvent.click(screen.getByRole("button", { name: "Show citations" }));
      expect(onShowCitationsChange).toHaveBeenCalledWith(true);
    });
  });

  describe("show cardbox toggle", () => {
    it("renders Show cardbox edges button when onShowCardboxChange provided", () => {
      render(<GraphToolbar {...defaults} onShowCardboxChange={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Show cardbox edges" })).toBeTruthy();
    });

    it("Show cardbox edges button not rendered when onShowCardboxChange is undefined", () => {
      render(<GraphToolbar {...defaults} />);
      expect(screen.queryByRole("button", { name: "Show cardbox edges" })).toBeNull();
    });

    it("Show cardbox edges button has aria-pressed=true when showCardbox=true", () => {
      render(<GraphToolbar {...defaults} showCardbox={true} onShowCardboxChange={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Show cardbox edges" }).getAttribute("aria-pressed")).toBe("true");
    });

    it("Show cardbox edges button has aria-pressed=false when showCardbox=false", () => {
      render(<GraphToolbar {...defaults} showCardbox={false} onShowCardboxChange={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Show cardbox edges" }).getAttribute("aria-pressed")).toBe("false");
    });

    it("clicking Show cardbox edges toggles via onShowCardboxChange", async () => {
      const onShowCardboxChange = vi.fn();
      render(<GraphToolbar {...defaults} showCardbox={false} onShowCardboxChange={onShowCardboxChange} />);
      await userEvent.click(screen.getByRole("button", { name: "Show cardbox edges" }));
      expect(onShowCardboxChange).toHaveBeenCalledWith(true);
    });
  });

  describe("selection badge", () => {
    it("renders badge with selectionCount=3 showing '3'", () => {
      render(<GraphToolbar {...defaults} selectionCount={3} />);
      const badge = screen.getByTestId("selection-badge");
      expect(badge.textContent).toBe("3");
    });

    it("badge hidden when selectionCount=0", () => {
      render(<GraphToolbar {...defaults} selectionCount={0} />);
      expect(screen.queryByTestId("selection-badge")).toBeNull();
    });

    it("badge hidden when selectionCount is undefined", () => {
      render(<GraphToolbar {...defaults} />);
      expect(screen.queryByTestId("selection-badge")).toBeNull();
    });
  });
});

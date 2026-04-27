import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IndexingScreen } from "./IndexingScreen";

describe("IndexingScreen", () => {
  it("renders 'Scanning files...' when phase is scanning", () => {
    render(<IndexingScreen progress={{ phase: "scanning", current: 10, total: 10 }} />);
    expect(screen.getByTestId("phase-label").textContent).toBe("Scanning files...");
  });

  it("renders 'Parsing pages...' when phase is parsing", () => {
    render(<IndexingScreen progress={{ phase: "parsing", current: 3, total: 10 }} />);
    expect(screen.getByTestId("phase-label").textContent).toBe("Parsing pages...");
  });

  it("renders 'Resolving links...' when phase is resolving", () => {
    render(<IndexingScreen progress={{ phase: "resolving", current: 5, total: 10 }} />);
    expect(screen.getByTestId("phase-label").textContent).toBe("Resolving links...");
  });

  it("renders 'Checking for changes...' when phase is diffing", () => {
    render(<IndexingScreen progress={{ phase: "diffing", current: 0, total: 0 }} />);
    expect(screen.getByTestId("phase-label").textContent).toBe("Checking for changes...");
  });

  it("renders 'Building graph...' when phase is building", () => {
    render(<IndexingScreen progress={{ phase: "building", current: 0, total: 0 }} />);
    expect(screen.getByTestId("phase-label").textContent).toBe("Building graph...");
  });

  it("progress bar width reflects current/total ratio", () => {
    render(<IndexingScreen progress={{ phase: "parsing", current: 3, total: 10 }} />);
    const fill = screen.getByTestId("progress-bar-fill");
    expect(fill.style.width).toBe("30%");
  });

  it("progress bar is full when current equals total", () => {
    render(<IndexingScreen progress={{ phase: "resolving", current: 10, total: 10 }} />);
    const fill = screen.getByTestId("progress-bar-fill");
    expect(fill.style.width).toBe("100%");
  });

  it("shows 'Initializing...' when progress is null", () => {
    render(<IndexingScreen progress={null} />);
    expect(screen.getByTestId("phase-label").textContent).toBe("Initializing...");
  });

  it("shows indeterminate state when total is 0", () => {
    render(<IndexingScreen progress={{ phase: "building", current: 0, total: 0 }} />);
    const fill = screen.getByTestId("progress-bar-fill");
    expect(fill.className).toContain("animate-pulse");
    expect(fill.style.width).toBe("100%");
  });
});

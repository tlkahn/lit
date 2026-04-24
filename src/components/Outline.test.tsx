import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useWorkspaceStore } from "../stores/workspace";
import { Outline } from "./Outline";

beforeEach(() => {
  useWorkspaceStore.setState({
    workspacePath: "/test",
    pages: [],
    currentPagePath: null,
    currentPageHeadings: [],
    loading: false,
    error: null,
  });
});

describe("Outline", () => {
  it("shows 'No page selected' when no page selected", () => {
    render(<Outline />);
    expect(screen.getByText("No page selected")).toBeInTheDocument();
  });

  it("shows 'No headings' when page has no headings", () => {
    useWorkspaceStore.setState({ currentPagePath: "test.md", currentPageHeadings: [] });
    render(<Outline />);
    expect(screen.getByText("No headings")).toBeInTheDocument();
  });

  it("renders heading text for each heading", () => {
    useWorkspaceStore.setState({
      currentPagePath: "test.md",
      currentPageHeadings: [
        { level: 1, text: "Title", line: 0, from: 0, to: 7 },
        { level: 2, text: "Section", line: 5, from: 30, to: 40 },
      ],
    });
    render(<Outline />);
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Section")).toBeInTheDocument();
  });

  it("applies correct indentation based on level", () => {
    useWorkspaceStore.setState({
      currentPagePath: "test.md",
      currentPageHeadings: [
        { level: 1, text: "H1", line: 0, from: 0, to: 4 },
        { level: 3, text: "H3", line: 2, from: 10, to: 16 },
      ],
    });
    render(<Outline />);
    const h1 = screen.getByText("H1");
    const h3 = screen.getByText("H3");
    expect(h1.style.paddingLeft).toBe("8px");
    expect(h3.style.paddingLeft).toBe("32px");
  });

  it("dispatches lit:scroll-to-line event on click", async () => {
    useWorkspaceStore.setState({
      currentPagePath: "test.md",
      currentPageHeadings: [
        { level: 1, text: "Title", line: 7, from: 50, to: 57 },
      ],
    });
    render(<Outline />);

    const handler = vi.fn();
    window.addEventListener("lit:scroll-to-line", handler);

    const user = userEvent.setup();
    await user.click(screen.getByText("Title"));

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ line: 7 });

    window.removeEventListener("lit:scroll-to-line", handler);
  });

  it("falls back to H${level} for empty heading text", () => {
    useWorkspaceStore.setState({
      currentPagePath: "test.md",
      currentPageHeadings: [
        { level: 2, text: "", line: 0, from: 0, to: 3 },
      ],
    });
    render(<Outline />);
    expect(screen.getByText("H2")).toBeInTheDocument();
  });
});

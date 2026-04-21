import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CodeMirrorEditor } from "./CodeMirrorEditor";

describe("CodeMirrorEditor", () => {
  it("renders container with data-testid='editor'", () => {
    render(<CodeMirrorEditor doc="" />);
    expect(screen.getByTestId("editor")).toBeInTheDocument();
  });

  it("has .cm-editor element inside", () => {
    render(<CodeMirrorEditor doc="" />);
    const container = screen.getByTestId("editor");
    expect(container.querySelector(".cm-editor")).not.toBeNull();
  });

  it("displays document content", () => {
    render(<CodeMirrorEditor doc="hello world" />);
    const container = screen.getByTestId("editor");
    expect(container.textContent).toContain("hello world");
  });

  it("has flex-1 layout class", () => {
    render(<CodeMirrorEditor doc="" />);
    const container = screen.getByTestId("editor");
    expect(container.className).toContain("flex-1");
  });
});

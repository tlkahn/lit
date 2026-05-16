import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { SettingsJsonEditor } from "./SettingsJsonEditor";

describe("SettingsJsonEditor", () => {
  it("renders container with data-testid='settings-json-editor'", () => {
    render(<SettingsJsonEditor initialJson="{}" onSave={vi.fn()} />);
    expect(screen.getByTestId("settings-json-editor")).toBeInTheDocument();
  });

  it("mounts a .cm-editor inside the container", () => {
    render(<SettingsJsonEditor initialJson="{}" onSave={vi.fn()} />);
    const container = screen.getByTestId("settings-json-editor");
    expect(container.querySelector(".cm-editor")).not.toBeNull();
  });

  it("displays the provided JSON content", () => {
    const json = '{"hello": "world"}';
    render(<SettingsJsonEditor initialJson={json} onSave={vi.fn()} />);
    const container = screen.getByTestId("settings-json-editor");
    expect(container.textContent).toContain('"hello"');
    expect(container.textContent).toContain('"world"');
  });

  it("renders a Save button with data-testid='settings-json-save'", () => {
    render(<SettingsJsonEditor initialJson="{}" onSave={vi.fn()} />);
    expect(screen.getByTestId("settings-json-save")).toBeInTheDocument();
  });

  it("clicking Save calls onSave with current editor content", () => {
    const onSave = vi.fn();
    render(<SettingsJsonEditor initialJson='{"a":1}' onSave={onSave} />);
    fireEvent.click(screen.getByTestId("settings-json-save"));
    expect(onSave).toHaveBeenCalledWith('{"a":1}');
  });

  it("Cmd+S triggers save", () => {
    const onSave = vi.fn();
    render(<SettingsJsonEditor initialJson='{"b":2}' onSave={onSave} />);
    const container = screen.getByTestId("settings-json-editor");
    fireEvent.keyDown(container, { key: "s", metaKey: true });
    expect(onSave).toHaveBeenCalledWith('{"b":2}');
  });

  it("Ctrl+S triggers save", () => {
    const onSave = vi.fn();
    render(<SettingsJsonEditor initialJson='{"c":3}' onSave={onSave} />);
    const container = screen.getByTestId("settings-json-editor");
    fireEvent.keyDown(container, { key: "s", ctrlKey: true });
    expect(onSave).toHaveBeenCalledWith('{"c":3}');
  });

  it("does not call onSave when content is invalid JSON", () => {
    const onSave = vi.fn();
    render(<SettingsJsonEditor initialJson="not json" onSave={onSave} />);
    fireEvent.click(screen.getByTestId("settings-json-save"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows error element with data-testid='settings-json-error' for invalid JSON on save", () => {
    render(<SettingsJsonEditor initialJson="not json" onSave={vi.fn()} />);
    fireEvent.click(screen.getByTestId("settings-json-save"));
    expect(screen.getByTestId("settings-json-error")).toBeInTheDocument();
  });

  it("error message contains parse error details", () => {
    render(<SettingsJsonEditor initialJson="not json" onSave={vi.fn()} />);
    fireEvent.click(screen.getByTestId("settings-json-save"));
    const errorEl = screen.getByTestId("settings-json-error");
    expect(errorEl.textContent).toBeTruthy();
    expect(errorEl.textContent!.length).toBeGreaterThan(0);
  });

  it("error clears on next successful save attempt", () => {
    const onSave = vi.fn();
    render(<SettingsJsonEditor initialJson="not json" onSave={onSave} />);
    fireEvent.click(screen.getByTestId("settings-json-save"));
    expect(screen.getByTestId("settings-json-error")).toBeInTheDocument();

    const container = screen.getByTestId("settings-json-editor");
    const cmEditor = container.querySelector(".cm-editor")!;
    const view = EditorView.findFromDOM(cmEditor as HTMLElement)!;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: '{"valid":true}' },
    });

    fireEvent.click(screen.getByTestId("settings-json-save"));
    expect(screen.queryByTestId("settings-json-error")).toBeNull();
    expect(onSave).toHaveBeenCalledWith('{"valid":true}');
  });

  it("Cmd+S from inside cm-content calls onSave exactly once", () => {
    const onSave = vi.fn();
    render(<SettingsJsonEditor initialJson='{"d":4}' onSave={onSave} />);
    const container = screen.getByTestId("settings-json-editor");
    const cmContent = container.querySelector(".cm-content")!;
    fireEvent.keyDown(cmContent, { key: "s", metaKey: true, bubbles: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("includes jsonParseLinter in CM6 extensions", async () => {
    const { linter } = await import("@codemirror/lint");
    const { jsonParseLinter } = await import("@codemirror/lang-json");

    render(<SettingsJsonEditor initialJson="{}" onSave={vi.fn()} />);
    const container = screen.getByTestId("settings-json-editor");
    const cmEditor = container.querySelector(".cm-editor")!;
    const view = EditorView.findFromDOM(cmEditor as HTMLElement)!;

    // Build a baseline state without the linter extension to compare field counts
    const { EditorState } = await import("@codemirror/state");
    const { json: jsonLang } = await import("@codemirror/lang-json");
    const baseline = EditorState.create({
      doc: "{}",
      extensions: [jsonLang()],
    });
    const withLinter = EditorState.create({
      doc: "{}",
      extensions: [jsonLang(), linter(jsonParseLinter())],
    });
    const linterFieldCount =
      (withLinter as any).values.length - (baseline as any).values.length;

    // The editor's state should have at least as many fields as baseline + linter
    expect((view.state as any).values.length).toBeGreaterThanOrEqual(
      (baseline as any).values.length + linterFieldCount,
    );
  });
});

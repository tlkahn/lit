import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});

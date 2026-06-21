import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { mockInvoke } from "../test/tauri-mock";
import { useCardboxStore } from "../stores/cardbox";
import { useWorkspaceStore } from "../stores/workspace";
import type { CardboxAnnotation } from "../lib/ipc";

// Mock modules that CardboxView's deps require
vi.mock("sigma", () => ({
  default: class MockSigma {
    kill = vi.fn();
    on = vi.fn();
    off = vi.fn();
    refresh = vi.fn();
    setSetting = vi.fn();
    getCamera = () => ({ animatedReset: vi.fn() });
  },
}));
vi.mock("@sigma/node-border", () => ({
  createNodeBorderProgram: () => class {},
}));

const sampleAnnotation: CardboxAnnotation = {
  uuid: "ann-1",
  annotation_type: "note",
  certainty: "neutral",
  body: "Test annotation body",
  date: "2026-06-15",
  source_page_id: "test.md",
  source_page_title: "Test Document",
  source_line: 5,
  char_start: 10,
  char_end: 50,
  scope_kind: "words",
  scope_value: "1",
  original: "Original text",
};

describe("CardboxView", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspacePath: "/test" });
    // Set up IPC mock
    mockInvoke((cmd) => {
      if (cmd === "list_all_annotations") return [sampleAnnotation];
      if (cmd === "read_cardbox_layout") return { order: ["ann-1"], links: [], groups: {}, pinned: [], notes: {}, colors: {} };
      if (cmd === "get_keymaps") return [];
      return null;
    });
  });

  it("toolbar div has zen-hide class for hiding in zen mode", async () => {
    // Seed the store with annotations so the toolbar renders
    useCardboxStore.setState({
      annotations: [sampleAnnotation],
      loading: false,
      order: ["ann-1"],
    });

    const { default: CardboxView } = await import("./CardboxView");
    render(<CardboxView />);

    const toolbar = screen.getByTestId("cardbox-toolbar");
    expect(toolbar).toHaveClass("zen-hide");
  });
});

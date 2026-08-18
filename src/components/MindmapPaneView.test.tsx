import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MindmapPaneView } from "./MindmapPaneView";

vi.mock("./MindmapView", () => ({ default: () => null }));

describe("MindmapPaneView", () => {
  it("host contains min-w-0 and overflow-hidden for pane containment", () => {
    render(<MindmapPaneView paneId="p1" pagePath="/doc.md" />);
    const host = document.querySelector("[data-testid='mindmap-view']") as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.className).toContain("min-w-0");
    expect(host.className).toContain("overflow-hidden");
    // Regression: flex min-size boundary pieces still present.
    expect(host.className).toContain("flex-1");
    expect(host.className).toContain("min-h-0");
  });
});

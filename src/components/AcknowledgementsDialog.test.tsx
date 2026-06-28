import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render } from "@testing-library/react";
import { AcknowledgementsDialog } from "./AcknowledgementsDialog";

// jsdom returns 0 for offsetHeight; the virtualizer reads it both to size the
// scroll-container viewport and to measure each rendered item. We need 600 for
// the container (so items are "in view") and a small value for items themselves.
const origOffsetHeightGet = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!.get!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      // Virtual items have a data-index attribute; give them a realistic height.
      if (this.hasAttribute?.("data-index")) return 28;
      // The scroll container (and other ancestors) get a large viewport height.
      return 600;
    },
  });
});
afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: origOffsetHeightGet,
  });
});

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

vi.mock("../data/acknowledgements.json", () => ({
  default: {
    rust: [
      { name: "windows-sys", version: "0.48.0", license: "MIT", repository: "" },
      { name: "windows-sys", version: "0.52.0", license: "MIT", repository: "" },
    ],
    js: [
      {
        name: "bare-shorthand-pkg",
        version: "1.0.0",
        license: "MIT",
        repository: "owner/name",
      },
      {
        name: "github-prefixed-pkg",
        version: "2.0.0",
        license: "MIT",
        repository: "github:owner/repo",
      },
      {
        name: "proper-url-pkg",
        version: "3.0.0",
        license: "MIT",
        repository: "https://github.com/owner/repo",
      },
      {
        name: "empty-repo-pkg",
        version: "4.0.0",
        license: "MIT",
        repository: "",
      },
    ],
    fonts: [],
  },
}));

describe("AcknowledgementsDialog", () => {
  it("does not render a link button for bare shorthand repo string", () => {
    const { container } = render(
      <AcknowledgementsDialog open={true} onClose={vi.fn()} />,
    );
    const buttons = container.querySelectorAll("button");
    const buttonTexts = Array.from(buttons).map((b) => b.textContent);
    // bare-shorthand-pkg and github-prefixed-pkg should NOT be buttons
    expect(buttonTexts).not.toContain("bare-shorthand-pkg");
    expect(buttonTexts).not.toContain("github-prefixed-pkg");
  });

  it("renders a link button for proper http URL", () => {
    const { container } = render(
      <AcknowledgementsDialog open={true} onClose={vi.fn()} />,
    );
    const buttons = container.querySelectorAll("button");
    const buttonTexts = Array.from(buttons).map((b) => b.textContent);
    expect(buttonTexts).toContain("proper-url-pkg");
  });

  it("does not emit duplicate key warnings for deps with the same name but different versions", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AcknowledgementsDialog open={true} onClose={vi.fn()} />,
    );
    const dupKeyWarnings = spy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].includes("same key"),
    );
    expect(dupKeyWarnings).toHaveLength(0);
    spy.mockRestore();
  });

  it("renders plain text for empty repository", () => {
    const { container } = render(
      <AcknowledgementsDialog open={true} onClose={vi.fn()} />,
    );
    const buttons = container.querySelectorAll("button");
    const buttonTexts = Array.from(buttons).map((b) => b.textContent);
    expect(buttonTexts).not.toContain("empty-repo-pkg");
  });

  it("has a default export for React.lazy compatibility", async () => {
    const mod = await import("./AcknowledgementsDialog");
    expect(mod.default).toBe(mod.AcknowledgementsDialog);
  });

  it("uses a virtualized container for the dependency list", () => {
    const { container } = render(
      <AcknowledgementsDialog open={true} onClose={vi.fn()} />,
    );
    // The virtualizer creates a tall container div with position: relative
    const virtualContainer = container.querySelector('[style*="position: relative"]');
    expect(virtualContainer).not.toBeNull();
    // The total height should be set (non-zero height style from getTotalSize)
    expect(virtualContainer?.getAttribute("style")).toMatch(/height:\s*\d+/);
  });
});

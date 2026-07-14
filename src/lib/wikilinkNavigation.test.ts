import { describe, it, expect, vi } from "vitest";
import { navigateWikilink, type NavigationDeps } from "./wikilinkNavigation";

function makeDeps(overrides?: Partial<NavigationDeps>): NavigationDeps {
  return {
    resolveWikilink: vi.fn().mockResolvedValue({
      target: "Page",
      node_id: "Page.md",
      tier: "Stem",
    }),
    createPage: vi.fn().mockResolvedValue({
      title: "New",
      relative_path: "New.md",
      frontmatter: {},
      created_at: null,
      modified_at: null,
      file_type: 'markdown',
    }),
    selectPage: vi.fn(),
    setPendingSection: vi.fn(),
    currentPagePath: "Current.md",
    triggerReload: vi.fn(),
    ...overrides,
  };
}

describe("navigateWikilink", () => {
  it("resolves existing page and calls selectPage", async () => {
    const deps = makeDeps();
    await navigateWikilink("Page", undefined, deps);
    expect(deps.resolveWikilink).toHaveBeenCalledWith("Page");
    expect(deps.selectPage).toHaveBeenCalledWith("Page.md");
    expect(deps.createPage).not.toHaveBeenCalled();
  });

  it("auto-creates page when unresolved, then navigates", async () => {
    const deps = makeDeps({
      resolveWikilink: vi.fn().mockResolvedValue({
        target: "NewPage",
        node_id: null,
        tier: "Unresolved",
      }),
      createPage: vi.fn().mockResolvedValue({
        title: "NewPage",
        relative_path: "NewPage.md",
        frontmatter: {},
        created_at: null,
        modified_at: null,
        file_type: 'markdown',
      }),
    });
    await navigateWikilink("NewPage", undefined, deps);
    expect(deps.createPage).toHaveBeenCalledWith("NewPage");
    expect(deps.selectPage).toHaveBeenCalledWith("NewPage.md");
  });

  it("with section sets pendingSection on store", async () => {
    const deps = makeDeps();
    await navigateWikilink("Page", "Heading", deps);
    expect(deps.setPendingSection).toHaveBeenCalledWith("Heading");
    expect(deps.selectPage).toHaveBeenCalledWith("Page.md");
  });

  it("delivers a block-anchor section (^id) verbatim to pendingSection", async () => {
    const deps = makeDeps();
    await navigateWikilink("Page", "^3141e2", deps);
    expect(deps.setPendingSection).toHaveBeenCalledWith("^3141e2");
    expect(deps.selectPage).toHaveBeenCalledWith("Page.md");
  });

  it("same-page section (#Section only) sets pendingSection without changing page", async () => {
    const deps = makeDeps();
    await navigateWikilink("", "Heading", deps);
    expect(deps.setPendingSection).toHaveBeenCalledWith("Heading");
    expect(deps.triggerReload).toHaveBeenCalled();
    expect(deps.resolveWikilink).not.toHaveBeenCalled();
    expect(deps.selectPage).not.toHaveBeenCalled();
  });

  it("calls recordDeparture before cross-page navigation", async () => {
    const recordDeparture = vi.fn();
    const deps = makeDeps({ recordDeparture });
    await navigateWikilink("Page", undefined, deps);
    expect(recordDeparture).toHaveBeenCalledOnce();
    expect(recordDeparture.mock.invocationCallOrder[0]).toBeLessThan(
      (deps.selectPage as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
    );
  });

  it("calls recordDeparture before same-page section navigation", async () => {
    const recordDeparture = vi.fn();
    const deps = makeDeps({ recordDeparture });
    await navigateWikilink("", "Heading", deps);
    expect(recordDeparture).toHaveBeenCalledOnce();
    expect(recordDeparture.mock.invocationCallOrder[0]).toBeLessThan(
      (deps.triggerReload as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
    );
  });

  it("calls recordDeparture even when page creation is needed", async () => {
    const recordDeparture = vi.fn();
    const deps = makeDeps({
      recordDeparture,
      resolveWikilink: vi.fn().mockResolvedValue({
        target: "NewPage",
        node_id: null,
        tier: "Unresolved",
      }),
      createPage: vi.fn().mockResolvedValue({
        title: "NewPage",
        relative_path: "NewPage.md",
        frontmatter: {},
        created_at: null,
        modified_at: null,
        file_type: 'markdown',
      }),
    });
    await navigateWikilink("NewPage", undefined, deps);
    expect(recordDeparture).toHaveBeenCalledOnce();
  });

  it("pendingSection survives selectPage on cross-page navigation (regression)", async () => {
    let pendingSection: string | null = "STALE";
    const deps = makeDeps({
      selectPage: vi.fn(() => { pendingSection = null; }),
      setPendingSection: vi.fn((s: string) => { pendingSection = s; }),
    });
    await navigateWikilink("Page", "^3141e2", deps);
    expect(pendingSection).toBe("^3141e2");
  });

  it("pendingSection survives selectPage when the target page must be created", async () => {
    let pendingSection: string | null = null;
    const deps = makeDeps({
      resolveWikilink: vi.fn().mockResolvedValue({
        target: "NewPage",
        node_id: null,
        tier: "Unresolved",
      }),
      createPage: vi.fn().mockResolvedValue({
        title: "NewPage",
        relative_path: "NewPage.md",
        frontmatter: {},
        created_at: null,
        modified_at: null,
        file_type: 'markdown',
      }),
      selectPage: vi.fn(() => { pendingSection = null; }),
      setPendingSection: vi.fn((s: string) => { pendingSection = s; }),
    });
    await navigateWikilink("NewPage", "^abc123", deps);
    expect(pendingSection).toBe("^abc123");
  });

  it("empty-target section link scrolls in place when scrollToSection is provided", async () => {
    // The triggerReload fallback fails on a dirty doc (the reload path only
    // acknowledges the file hash), so in-place scroll must win when available.
    const scrollToSection = vi.fn();
    const deps = makeDeps({ scrollToSection });
    await navigateWikilink("", "^anchor", deps);
    expect(scrollToSection).toHaveBeenCalledWith("^anchor");
    expect(deps.setPendingSection).not.toHaveBeenCalled();
    expect(deps.triggerReload).not.toHaveBeenCalled();
  });

  it("scrolls in place when the resolved target is the current page (finding 2)", async () => {
    // selectPage on the already-open path never replaces the doc, so a
    // pendingSection would go unconsumed. The in-place scroll dep must be
    // used instead.
    const scrollToSection = vi.fn();
    const deps = makeDeps({ currentPagePath: "Page.md", scrollToSection });
    await navigateWikilink("Page", "^abc", deps);
    expect(scrollToSection).toHaveBeenCalledWith("^abc");
    expect(deps.setPendingSection).not.toHaveBeenCalled();
  });

  it("still uses pendingSection for same-page targets when scrollToSection is absent", async () => {
    const deps = makeDeps({ currentPagePath: "Page.md" });
    await navigateWikilink("Page", "^abc", deps);
    expect(deps.setPendingSection).toHaveBeenCalledWith("^abc");
  });

  it("uses pendingSection for cross-page targets even when scrollToSection is provided", async () => {
    const scrollToSection = vi.fn();
    const deps = makeDeps({ currentPagePath: "Other.md", scrollToSection });
    await navigateWikilink("Page", "^abc", deps);
    expect(deps.setPendingSection).toHaveBeenCalledWith("^abc");
    expect(scrollToSection).not.toHaveBeenCalled();
  });

  it("handles IPC error gracefully (no crash, logs error)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({
      resolveWikilink: vi.fn().mockRejectedValue(new Error("IPC fail")),
    });
    await navigateWikilink("Page", undefined, deps);
    expect(consoleSpy).toHaveBeenCalled();
    expect(deps.selectPage).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

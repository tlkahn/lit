import { describe, it, expect, vi, beforeEach } from "vitest";

const mockWorkspaceState = vi.hoisted(() => ({
  workspacePath: "/tmp/vault" as string | null,
  pages: [] as Array<{ title: string }>,
  createPage: vi.fn(),
}));

vi.mock("../stores/workspace", () => ({
  useWorkspaceStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockWorkspaceState),
    { getState: () => mockWorkspaceState },
  ),
}));

import { createUntitledPage } from "./newPage";

describe("createUntitledPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceState.workspacePath = "/tmp/vault";
    mockWorkspaceState.pages = [];
    mockWorkspaceState.createPage = vi.fn();
  });

  it("calls createPage('Untitled') for an empty workspace", () => {
    createUntitledPage();
    expect(mockWorkspaceState.createPage).toHaveBeenCalledWith("Untitled");
  });

  it("calls createPage('Untitled 1') when 'Untitled' already exists", () => {
    mockWorkspaceState.pages = [{ title: "Untitled" }];
    createUntitledPage();
    expect(mockWorkspaceState.createPage).toHaveBeenCalledWith("Untitled 1");
  });

  it("calls createPage('Untitled 2') when 'Untitled' and 'Untitled 1' exist", () => {
    mockWorkspaceState.pages = [{ title: "Untitled" }, { title: "Untitled 1" }];
    createUntitledPage();
    expect(mockWorkspaceState.createPage).toHaveBeenCalledWith("Untitled 2");
  });

  it("does not call createPage when workspacePath is null", () => {
    mockWorkspaceState.workspacePath = null;
    createUntitledPage();
    expect(mockWorkspaceState.createPage).not.toHaveBeenCalled();
  });

  it("returns undefined when workspacePath is null", () => {
    mockWorkspaceState.workspacePath = null;
    expect(createUntitledPage()).toBeUndefined();
  });

  it("forwards the createPage promise", async () => {
    const p = Promise.resolve();
    mockWorkspaceState.createPage = vi.fn(() => p);
    const result = createUntitledPage();
    expect(result).toBe(p);
    expect(mockWorkspaceState.createPage).toHaveBeenCalledWith("Untitled");
    await result;
  });
});

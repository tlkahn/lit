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

import { createUntitledPage, _resetCreateUntitledPageQueueForTesting } from "./newPage";

describe("createUntitledPage", () => {
  beforeEach(() => {
    _resetCreateUntitledPageQueueForTesting();
    vi.clearAllMocks();
    mockWorkspaceState.workspacePath = "/tmp/vault";
    mockWorkspaceState.pages = [];
    mockWorkspaceState.createPage = vi.fn();
  });

  it("calls createPage('Untitled') for an empty workspace", async () => {
    await createUntitledPage();
    expect(mockWorkspaceState.createPage).toHaveBeenCalledWith("Untitled");
  });

  it("calls createPage('Untitled 1') when 'Untitled' already exists", async () => {
    mockWorkspaceState.pages = [{ title: "Untitled" }];
    await createUntitledPage();
    expect(mockWorkspaceState.createPage).toHaveBeenCalledWith("Untitled 1");
  });

  it("calls createPage('Untitled 2') when 'Untitled' and 'Untitled 1' exist", async () => {
    mockWorkspaceState.pages = [{ title: "Untitled" }, { title: "Untitled 1" }];
    await createUntitledPage();
    expect(mockWorkspaceState.createPage).toHaveBeenCalledWith("Untitled 2");
  });

  it("does not call createPage when workspacePath is null", async () => {
    mockWorkspaceState.workspacePath = null;
    await createUntitledPage();
    expect(mockWorkspaceState.createPage).not.toHaveBeenCalled();
  });

  it("resolves without calling createPage when workspacePath is null", async () => {
    mockWorkspaceState.workspacePath = null;
    await expect(createUntitledPage()).resolves.toBeUndefined();
    expect(mockWorkspaceState.createPage).not.toHaveBeenCalled();
  });

  it("awaits createPage before resolving", async () => {
    const p = Promise.resolve();
    mockWorkspaceState.createPage = vi.fn(() => p);
    await createUntitledPage();
    expect(mockWorkspaceState.createPage).toHaveBeenCalledWith("Untitled");
  });

  it("serializes overlapping calls so the second names after the first resolves", async () => {
    let release!: () => void;
    const firstGate = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    mockWorkspaceState.createPage = vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        return firstGate.then(() => {
          mockWorkspaceState.pages = [{ title: "Untitled" }];
        });
      }
      return Promise.resolve();
    });

    const p1 = createUntitledPage();
    const p2 = createUntitledPage();

    // Before the first createPage resolves, the second call must not have run.
    await Promise.resolve();
    expect(mockWorkspaceState.createPage).toHaveBeenCalledTimes(1);
    expect(mockWorkspaceState.createPage).toHaveBeenCalledWith("Untitled");

    release();
    await Promise.all([p1, p2]);

    expect(mockWorkspaceState.createPage).toHaveBeenCalledTimes(2);
    expect(mockWorkspaceState.createPage).toHaveBeenLastCalledWith("Untitled 1");
  });
});

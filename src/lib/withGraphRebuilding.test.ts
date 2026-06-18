import { describe, it, expect, vi, beforeEach } from "vitest";

const mockWorkspaceState = vi.hoisted(() => ({
  graphReady: true,
}));

vi.mock("../stores/workspace", () => ({
  useWorkspaceStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockWorkspaceState),
    {
      getState: () => mockWorkspaceState,
      setState: (partial: Record<string, unknown>) => Object.assign(mockWorkspaceState, partial),
    },
  ),
}));

import { withGraphRebuilding } from "./withGraphRebuilding";

describe("withGraphRebuilding", () => {
  beforeEach(() => {
    mockWorkspaceState.graphReady = true;
  });

  it("sets graphReady to false before calling fn", async () => {
    let graphReadyDuringFn: boolean | undefined;
    await withGraphRebuilding(async () => {
      graphReadyDuringFn = mockWorkspaceState.graphReady;
    });
    expect(graphReadyDuringFn).toBe(false);
  });

  it("sets graphReady to true after fn resolves", async () => {
    await withGraphRebuilding(async () => {});
    expect(mockWorkspaceState.graphReady).toBe(true);
  });

  it("sets graphReady to true even if fn rejects (finally semantics)", async () => {
    await withGraphRebuilding(async () => {
      throw new Error("boom");
    }).catch(() => {});
    expect(mockWorkspaceState.graphReady).toBe(true);
  });

  it("returns the value from fn", async () => {
    const result = await withGraphRebuilding(async () => 42);
    expect(result).toBe(42);
  });

  it("propagates the rejection from fn", async () => {
    await expect(
      withGraphRebuilding(async () => {
        throw new Error("test error");
      }),
    ).rejects.toThrow("test error");
  });
});

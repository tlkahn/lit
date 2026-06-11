import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { PageMeta } from "../lib/ipc";

// Mock materializeCitation
vi.mock("../lib/ipc", () => ({
  materializeCitation: vi.fn(),
}));

// We need to mock useWorkspaceStore.setState
vi.mock("../stores/workspace", () => {
  const store = {
    setState: vi.fn(),
  };
  return { useWorkspaceStore: store };
});

import { useMaterializeCitation } from "./useMaterializeCitation";
import { materializeCitation } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";

const mockedMaterialize = materializeCitation as unknown as ReturnType<typeof vi.fn>;
const mockedSetState = (useWorkspaceStore as unknown as { setState: ReturnType<typeof vi.fn> }).setState;

const fakeMeta: PageMeta = {
  title: "Smith 2024",
  relative_path: "references/smith2024.md",
  frontmatter: {},
  created_at: null,
  modified_at: null,
  file_type: "markdown",
};

describe("useMaterializeCitation", () => {
  let recordDeparture: ReturnType<typeof vi.fn>;
  let selectPage: ReturnType<typeof vi.fn>;
  let onError: ReturnType<typeof vi.fn>;
  let onMaterialized: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    recordDeparture = vi.fn();
    selectPage = vi.fn();
    onError = vi.fn();
    onMaterialized = vi.fn();
    mockedMaterialize.mockReset();
    mockedSetState.mockReset();
  });

  it("calls materializeCitation, updates store, records departure, selects page, and calls onMaterialized", async () => {
    mockedMaterialize.mockResolvedValue(fakeMeta);

    const { result } = renderHook(() =>
      useMaterializeCitation({
        recordDeparture,
        selectPage,
        onError,
        onMaterialized,
      }),
    );

    await act(async () => {
      await result.current("smith2024");
    });

    expect(mockedMaterialize).toHaveBeenCalledWith("smith2024");
    expect(mockedSetState).toHaveBeenCalledTimes(1);
    // Verify the setState updater appends the new page
    const updater = mockedSetState.mock.calls[0]![0] as (state: { pages: PageMeta[] }) => { pages: PageMeta[] };
    const updated = updater({ pages: [] });
    expect(updated.pages).toEqual([fakeMeta]);
    // When the page already exists (race condition with refreshPages), do not duplicate
    const noDup = updater({ pages: [fakeMeta] });
    expect(noDup.pages).toEqual([fakeMeta]);
    expect(noDup.pages).toHaveLength(1);
    expect(onMaterialized).toHaveBeenCalled();
    expect(recordDeparture).toHaveBeenCalled();
    expect(selectPage).toHaveBeenCalledWith("references/smith2024.md");
  });

  it("does not duplicate page when relative_path already exists in store (race with refreshPages)", async () => {
    mockedMaterialize.mockResolvedValue(fakeMeta);

    const { result } = renderHook(() =>
      useMaterializeCitation({
        recordDeparture,
        selectPage,
        onError,
        onMaterialized,
      }),
    );

    await act(async () => {
      await result.current("smith2024");
    });

    // Simulate the race: refreshPages already added the page to state
    // before the setState updater runs
    const updater = mockedSetState.mock.calls[0]![0] as (state: { pages: PageMeta[] }) => { pages: PageMeta[] };
    const raceResult = updater({ pages: [fakeMeta] });
    expect(raceResult.pages).toHaveLength(1);
    expect(raceResult.pages[0]).toBe(fakeMeta); // reference equality — original preserved
  });

  it("calls onError and skips navigation when materializeCitation rejects", async () => {
    mockedMaterialize.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() =>
      useMaterializeCitation({
        recordDeparture,
        selectPage,
        onError,
        onMaterialized,
      }),
    );

    await act(async () => {
      await result.current("badkey");
    });

    expect(onError).toHaveBeenCalledWith("network error");
    expect(selectPage).not.toHaveBeenCalled();
    expect(recordDeparture).not.toHaveBeenCalled();
    expect(onMaterialized).not.toHaveBeenCalled();
  });

  it("surfaces non-Error rejection as string", async () => {
    mockedMaterialize.mockRejectedValue("Bib key 'foo' not found");

    const { result } = renderHook(() =>
      useMaterializeCitation({
        recordDeparture,
        selectPage,
        onError,
        onMaterialized,
      }),
    );

    await act(async () => {
      await result.current("foo");
    });

    expect(onError).toHaveBeenCalledWith("Bib key 'foo' not found");
    expect(selectPage).not.toHaveBeenCalled();
    expect(recordDeparture).not.toHaveBeenCalled();
    expect(onMaterialized).not.toHaveBeenCalled();
  });

  it("prevents re-entrant calls while a materialization is in-flight", async () => {
    let resolveFirst!: (v: PageMeta) => void;
    const firstPromise = new Promise<PageMeta>((r) => { resolveFirst = r; });
    mockedMaterialize.mockReturnValueOnce(firstPromise);
    mockedMaterialize.mockResolvedValueOnce(fakeMeta);

    const { result } = renderHook(() =>
      useMaterializeCitation({
        recordDeparture,
        selectPage,
        onError,
      }),
    );

    // Start first call (will be pending)
    let firstDone = false;
    act(() => {
      result.current("key1").then(() => { firstDone = true; });
    });

    // Second call while first is pending -- should be no-op
    await act(async () => {
      await result.current("key2");
    });

    expect(mockedMaterialize).toHaveBeenCalledTimes(1);
    expect(mockedMaterialize).toHaveBeenCalledWith("key1");

    // Resolve the first call
    await act(async () => {
      resolveFirst(fakeMeta);
      await firstPromise;
    });

    expect(firstDone).toBe(true);
    expect(selectPage).toHaveBeenCalledTimes(1);
  });

  it("works without onMaterialized callback", async () => {
    mockedMaterialize.mockResolvedValue(fakeMeta);

    const { result } = renderHook(() =>
      useMaterializeCitation({
        recordDeparture,
        selectPage,
        onError,
        // no onMaterialized
      }),
    );

    await act(async () => {
      await result.current("smith2024");
    });

    expect(mockedMaterialize).toHaveBeenCalledWith("smith2024");
    expect(selectPage).toHaveBeenCalledWith("references/smith2024.md");
    expect(recordDeparture).toHaveBeenCalled();
  });

  it("calls onNavigate instead of selectPage when onNavigate is provided", async () => {
    mockedMaterialize.mockResolvedValue(fakeMeta);
    const onNavigate = vi.fn();

    const { result } = renderHook(() =>
      useMaterializeCitation({
        recordDeparture,
        selectPage,
        onError,
        onMaterialized,
        onNavigate,
      }),
    );

    await act(async () => {
      await result.current("smith2024");
    });

    expect(mockedMaterialize).toHaveBeenCalledWith("smith2024");
    expect(onNavigate).toHaveBeenCalledWith("references/smith2024.md");
    expect(selectPage).not.toHaveBeenCalled();
    expect(recordDeparture).toHaveBeenCalled();
  });

  it("falls back to selectPage when onNavigate is not provided", async () => {
    mockedMaterialize.mockResolvedValue(fakeMeta);

    const { result } = renderHook(() =>
      useMaterializeCitation({
        recordDeparture,
        selectPage,
        onError,
        // onNavigate intentionally omitted
      }),
    );

    await act(async () => {
      await result.current("smith2024");
    });

    expect(selectPage).toHaveBeenCalledWith("references/smith2024.md");
    expect(recordDeparture).toHaveBeenCalled();
  });
});

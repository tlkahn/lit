import { describe, it, expect, vi, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { listen } from "@tauri-apps/api/event";
import { citeprocMatchesField } from "./citeproc";

vi.mock("../../lib/ipc", () => ({
  getBibKeyStates: vi.fn(async () => ({})),
  materializeCitation: vi.fn(async () => ({ relative_path: "note.md" })),
  resolveBibEntries: vi.fn(async () => []),
  renderBibCitations: vi.fn(async () => ({})),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("../../stores/workspace", () => {
  type Listener = (state: Record<string, unknown>, prev: Record<string, unknown>) => void;
  const listeners = new Set<Listener>();
  let currentState: Record<string, unknown> = {
    selectPage: vi.fn(),
    currentPagePath: "note.md",
    workspacePath: "/vault/one",
  };
  return {
    useWorkspaceStore: {
      getState: vi.fn(() => currentState),
      setState: vi.fn((partial: Record<string, unknown>) => {
        const prev = { ...currentState };
        currentState = { ...currentState, ...partial };
        for (const fn of listeners) fn(currentState, prev);
      }),
      subscribe: vi.fn((fn: Listener) => {
        listeners.add(fn);
        return () => { listeners.delete(fn); };
      }),
      /** Test helper: reset internal state */
      _resetForTest: () => {
        currentState = {
          selectPage: vi.fn(),
          currentPagePath: "note.md",
          workspacePath: "/vault/one",
        };
        listeners.clear();
      },
    },
  };
});

vi.mock("../../stores/statusMessage", () => {
  const showFn = vi.fn();
  return {
    useStatusMessageStore: {
      getState: vi.fn(() => ({ show: showFn })),
    },
  };
});

vi.mock("../../lib/materializeAndOpen", () => ({
  materializeAndOpen: vi.fn(async () => ({
    title: "Note",
    relative_path: "note.md",
    frontmatter: {},
    created_at: null,
    modified_at: null,
    file_type: "markdown",
    has_companion: false,
  })),
}));

vi.mock("../../lib/editorViewRef", () => ({
  getCurrentEditorView: vi.fn(() => null),
}));

vi.mock("../../editor/jumpTracker", () => ({
  globalJumpTracker: {
    recordJump: vi.fn(),
  },
}));

// Import AFTER mocks are set up
import {
  citeprocTooltipSource,
  citeprocHoverTracker,
  citeprocTooltipExtension,
  buildTooltipDom,
  invalidateBibKeyStatesCache,
  acquireInvalidationListeners,
  releaseInvalidationListeners,
  _resetSharedListenersForTest,
} from "./citeprocTooltip";
import { useWorkspaceStore } from "../../stores/workspace";
import { useStatusMessageStore } from "../../stores/statusMessage";
import { materializeAndOpen } from "../../lib/materializeAndOpen";
import { getCurrentEditorView } from "../../lib/editorViewRef";
import { globalJumpTracker } from "../../editor/jumpTracker";
import { trackView } from "../../test/cmView";

function makeViewWithMatches(
  doc: string,
  cursor = 0,
): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [citeprocMatchesField],
  });
  return trackView(new EditorView({ state, parent: document.createElement("div") }));
}

function makeViewWithTracker(
  doc: string,
  cursor = 0,
): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [citeprocMatchesField, citeprocHoverTracker],
  });
  return trackView(new EditorView({ state, parent: document.createElement("div") }));
}

describe("citeprocTooltipSource", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when pos is not in a citation range", () => {
    const view = makeViewWithMatches("Just plain text with no citations.");
    const result = citeprocTooltipSource(view, 5, 1);
    expect(result).toBeNull();
    view.destroy();
  });

  it("returns Tooltip with correct pos and end for single-key citation", () => {
    const doc = "See [@smith2020] here.";
    // citeprocMatchesField scans for [@...] patterns
    // "[@smith2020]" starts at index 4, ends at index 16
    const view = makeViewWithMatches(doc);
    const result = citeprocTooltipSource(view, 4, 1);
    expect(result).not.toBeNull();
    expect(result!.pos).toBe(4);
    expect(result!.end).toBe(16);
    expect(result!.above).toBe(true);
    view.destroy();
  });

  it("uses lastHoveredKey from tracker plugin for multi-key citation", () => {
    const doc = "[@a; @b]";
    // Match: from=0, to=8, keys=[{key:"a"}, {key:"b"}]
    const view = makeViewWithTracker(doc);
    const tracker = view.plugin(citeprocHoverTracker);
    expect(tracker).not.toBeNull();
    tracker!.lastHoveredKey = "b";

    const result = citeprocTooltipSource(view, 0, 1);
    expect(result).not.toBeNull();
    // Verify the tooltip DOM is built for key "b"
    const { dom } = result!.create!(view);
    // The DOM should contain a loading indicator initially and async populate
    // We just verify it creates a DOM element (detailed button behavior is async)
    expect(dom).toBeInstanceOf(HTMLElement);
    expect(dom.className).toBe("cm-citeproc-tooltip");
    view.destroy();
  });

  it("falls back to first key when lastHoveredKey is null", () => {
    const doc = "[@a; @b]";
    const view = makeViewWithTracker(doc);
    const tracker = view.plugin(citeprocHoverTracker);
    expect(tracker).not.toBeNull();
    tracker!.lastHoveredKey = null;

    const result = citeprocTooltipSource(view, 0, 1);
    expect(result).not.toBeNull();
    // Should use first key "a" — verify it creates DOM
    const { dom } = result!.create!(view);
    expect(dom.className).toBe("cm-citeproc-tooltip");
    view.destroy();
  });

  it("ignores stale lastHoveredKey not in match keys", () => {
    const doc = "[@a; @b]";
    const view = makeViewWithTracker(doc);
    const tracker = view.plugin(citeprocHoverTracker);
    expect(tracker).not.toBeNull();
    tracker!.lastHoveredKey = "z"; // not a key in the match

    const result = citeprocTooltipSource(view, 0, 1);
    expect(result).not.toBeNull();
    // Should fall back to first key "a"
    const { dom } = result!.create!(view);
    expect(dom.className).toBe("cm-citeproc-tooltip");
    view.destroy();
  });

  it("returns null when pos is between two citations but not in either range", () => {
    const doc = "[@a] some text [@b]";
    const view = makeViewWithMatches(doc);
    // pos 8 is in "some text", not in any citation
    const result = citeprocTooltipSource(view, 8, 1);
    expect(result).toBeNull();
    view.destroy();
  });
});

describe("buildTooltipDom regression", () => {
  it("tooltip DOM does NOT have onmouseenter/onmouseleave properties", () => {
    const doc = "[@smith2020]";
    const view = makeViewWithTracker(doc);
    const result = citeprocTooltipSource(view, 0, 1);
    expect(result).not.toBeNull();
    const { dom } = result!.create!(view);
    // The old implementation set mouseenter/mouseleave on the tooltip DOM.
    // The new implementation should NOT set these, as CM6 hoverTooltip handles it.
    expect(dom.onmouseenter).toBeNull();
    expect(dom.onmouseleave).toBeNull();
    view.destroy();
  });
});

describe("citeprocHoverTracker", () => {
  it("stores lastHoveredKey from mouseover on keySpan", () => {
    const doc = "test document";
    const view = makeViewWithTracker(doc);
    const tracker = view.plugin(citeprocHoverTracker);
    expect(tracker).not.toBeNull();

    // Create a fake keySpan element within the view DOM
    const keySpan = document.createElement("span");
    keySpan.className = "cm-crossref-citeproc-key";
    keySpan.dataset.citekey = "smith2020";
    view.dom.appendChild(keySpan);

    // Dispatch mouseover with the keySpan as target
    const event = new MouseEvent("mouseover", {
      bubbles: true,
      target: keySpan,
    } as MouseEventInit);
    // Need to dispatch on the keySpan so it bubbles up to view.dom
    keySpan.dispatchEvent(event);

    expect(tracker!.lastHoveredKey).toBe("smith2020");

    // Cleanup
    view.dom.removeChild(keySpan);
    view.destroy();
  });

  it("clears lastHoveredKey when mouseover target is not a keySpan", () => {
    const doc = "test document";
    const view = makeViewWithTracker(doc);
    const tracker = view.plugin(citeprocHoverTracker);
    expect(tracker).not.toBeNull();

    // First set a key
    tracker!.lastHoveredKey = "smith2020";

    // Dispatch mouseover on a non-keySpan element within view.dom
    const event = new MouseEvent("mouseover", { bubbles: true });
    view.dom.dispatchEvent(event);

    expect(tracker!.lastHoveredKey).toBeNull();
    view.destroy();
  });
});

describe("F1: rejection-poisons-cache", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    invalidateBibKeyStatesCache();
  });

  it("shows error message when getBibKeyStates rejects", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    (getBibKeyStates as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("graph not ready"),
    );
    invalidateBibKeyStatesCache();

    const dom = buildTooltipDom("smith2020");

    await vi.waitFor(() => {
      expect(dom.textContent).toBe("Failed to load — hover again to retry");
    });
  });

  it("retries getBibKeyStates on next hover after rejection", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const mock = getBibKeyStates as ReturnType<typeof vi.fn>;
    mock.mockRejectedValueOnce(new Error("transient failure"));
    invalidateBibKeyStatesCache();

    const dom1 = buildTooltipDom("smith2020");

    // Wait for rejection to settle
    await vi.waitFor(() => {
      expect(dom1.textContent).toContain("Failed to load");
    });

    // Now mock a successful response
    mock.mockResolvedValueOnce({
      smith2020: { materialization: "materialized", page_id: "note.md" },
    });
    const dom2 = buildTooltipDom("smith2020");

    await vi.waitFor(() => {
      expect(dom2.textContent).not.toContain("Loading");
      expect(dom2.querySelector("button")).not.toBeNull();
    });
  });

  it("calls getBibKeyStates again after rejection (not cached)", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const mock = getBibKeyStates as ReturnType<typeof vi.fn>;
    mock.mockRejectedValueOnce(new Error("fail"));
    invalidateBibKeyStatesCache();

    const dom1 = buildTooltipDom("key1");
    await vi.waitFor(() => {
      expect(dom1.textContent).toContain("Failed to load");
    });

    // Second call should invoke getBibKeyStates again
    mock.mockResolvedValueOnce({});
    buildTooltipDom("key1");

    await vi.waitFor(() => {
      // The mock should have been called twice total (once reject, once resolve)
      expect(mock).toHaveBeenCalledTimes(2);
    });
  });
});

describe("citeprocTooltipExtension regression guards", () => {
  it("does not export setCiteprocTooltip or clearCiteprocTooltip", async () => {
    const mod = await import("./citeprocTooltip");
    expect("setCiteprocTooltip" in mod).toBe(false);
    expect("clearCiteprocTooltip" in mod).toBe(false);
  });

  it("does not export scheduleClearTooltip or cancelClearTooltip", async () => {
    const mod = await import("./citeprocTooltip");
    expect("scheduleClearTooltip" in mod).toBe(false);
    expect("cancelClearTooltip" in mod).toBe(false);
  });

  it("citeprocTooltipExtension returns an array of extensions", () => {
    const ext = citeprocTooltipExtension();
    expect(Array.isArray(ext)).toBe(true);
    expect((ext as unknown[]).length).toBeGreaterThanOrEqual(2);
  });
});

describe("F5: listener-leak on early destroy", () => {
  const listenMock = vi.mocked(listen);

  function makeViewWithListener(doc: string): EditorView {
    const state = EditorState.create({
      doc,
      extensions: [citeprocMatchesField, citeprocTooltipExtension()],
    });
    return trackView(new EditorView({ state, parent: document.createElement("div") }));
  }

  afterEach(() => {
    vi.restoreAllMocks();
    invalidateBibKeyStatesCache();
  });

  it("calls unlisten when destroy is called after listen resolves", async () => {
    const unlistenFn = vi.fn();
    listenMock.mockImplementationOnce(async () => unlistenFn);

    const view = makeViewWithListener("test");
    // Let the listen promise resolve
    await vi.waitFor(() => {
      // listen was called
      expect(listenMock).toHaveBeenCalled();
    });
    // Flush microtasks so .then assigns unlisten
    await new Promise((r) => setTimeout(r, 0));

    view.destroy();
    expect(unlistenFn).toHaveBeenCalledTimes(1);
  });

  it("calls the late-resolving unlisten fn when destroy fires before listen resolves", async () => {
    const unlistenFn = vi.fn();
    let resolveListenPromise!: (fn: () => void) => void;
    listenMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveListenPromise = resolve;
        }),
    );

    const view = makeViewWithListener("test");
    // Destroy immediately, before listen promise resolves
    view.destroy();

    // Now resolve the listen promise -- the unlisten fn should be called immediately
    resolveListenPromise(unlistenFn);
    // Flush microtasks
    await new Promise((r) => setTimeout(r, 0));

    expect(unlistenFn).toHaveBeenCalledTimes(1);
  });

  it("does not call unlisten twice if destroy is called after listen resolves", async () => {
    const unlistenFn = vi.fn();
    listenMock.mockImplementationOnce(async () => unlistenFn);

    const view = makeViewWithListener("test");
    // Let the listen promise resolve
    await new Promise((r) => setTimeout(r, 0));

    view.destroy();
    // Flush any remaining microtasks
    await new Promise((r) => setTimeout(r, 0));

    expect(unlistenFn).toHaveBeenCalledTimes(1);
  });
});

describe("F3: cache-invalidation-gaps", () => {
  const listenMock = vi.mocked(listen);

  function makeViewWithListener(doc: string): EditorView {
    const state = EditorState.create({
      doc,
      extensions: [citeprocMatchesField, citeprocTooltipExtension()],
    });
    return trackView(new EditorView({ state, parent: document.createElement("div") }));
  }

  afterEach(() => {
    vi.restoreAllMocks();
    invalidateBibKeyStatesCache();
    (useWorkspaceStore as unknown as { _resetForTest: () => void })._resetForTest();
  });

  it("materializeAndOpen success invalidates bib key states cache", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;
    const materializeAndOpenMockLocal = vi.mocked(materializeAndOpen);

    // Prime the cache with a shadow entry
    getBibMock.mockResolvedValueOnce({
      key1: { materialization: "shadow", page_id: null },
    });
    materializeAndOpenMockLocal.mockResolvedValueOnce({
      title: "Key1",
      relative_path: "key1.md",
      frontmatter: {},
      created_at: null,
      modified_at: null,
      file_type: "markdown",
      has_companion: false,
    });
    invalidateBibKeyStatesCache();

    const dom = buildTooltipDom("key1");
    // Wait for "Create note" button to appear
    await vi.waitFor(() => {
      const btn = dom.querySelector("button");
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toBe("Create note");
    });

    // Click "Create note"
    dom.querySelector("button")!.click();
    // Wait for materializeAndOpen to resolve
    await vi.waitFor(() => {
      expect(materializeAndOpenMockLocal).toHaveBeenCalledWith(
        "key1",
        expect.objectContaining({ recordDeparture: expect.any(Function) }),
      );
    });
    // Flush microtasks so the .then(invalidateBibKeyStatesCache) runs
    await new Promise((r) => setTimeout(r, 0));

    // Now build another tooltip -- getBibKeyStates should be called again (cache was busted)
    getBibMock.mockResolvedValueOnce({
      key1: { materialization: "materialized", page_id: "key1.md" },
    });
    const dom2 = buildTooltipDom("key1");
    await vi.waitFor(() => {
      const btn = dom2.querySelector("button");
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toBe("Open note");
    });

    // getBibKeyStates should have been called twice total
    expect(getBibMock).toHaveBeenCalledTimes(2);
  });

  it("workspace://file-modified on .bib file invalidates cache", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;

    // Capture listen callbacks by event name
    const listenerCallbacks = new Map<string, (event: unknown) => void>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listenMock.mockImplementation(async (eventName: string, callback: any) => {
      listenerCallbacks.set(eventName, callback as (event: unknown) => void);
      return () => {};
    });

    // Prime the cache
    getBibMock.mockResolvedValueOnce({ k: { materialization: "shadow" } });
    invalidateBibKeyStatesCache();
    const dom = buildTooltipDom("k");
    await vi.waitFor(() => {
      expect(dom.querySelector("button")).not.toBeNull();
    });

    const view = makeViewWithListener("test");
    // Let all listen promises resolve
    await new Promise((r) => setTimeout(r, 0));

    // Fire a .bib file-modified event
    const cb = listenerCallbacks.get("workspace://file-modified");
    expect(cb).toBeDefined();
    cb!({ payload: { path: "refs.bib" } });

    // Cache should be invalidated -- next call triggers new IPC
    getBibMock.mockResolvedValueOnce({ k: { materialization: "materialized", page_id: "k.md" } });
    const dom2 = buildTooltipDom("k");
    await vi.waitFor(() => {
      expect(dom2.querySelector("button")?.textContent).toBe("Open note");
    });
    expect(getBibMock).toHaveBeenCalledTimes(2);

    view.destroy();
  });

  it("workspace://file-modified on non-.bib file does NOT invalidate cache", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;

    const listenerCallbacks = new Map<string, (event: unknown) => void>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listenMock.mockImplementation(async (eventName: string, callback: any) => {
      listenerCallbacks.set(eventName, callback as (event: unknown) => void);
      return () => {};
    });

    // Prime the cache
    getBibMock.mockResolvedValueOnce({ k: { materialization: "shadow" } });
    invalidateBibKeyStatesCache();
    const dom = buildTooltipDom("k");
    await vi.waitFor(() => {
      expect(dom.querySelector("button")).not.toBeNull();
    });

    const view = makeViewWithListener("test");
    await new Promise((r) => setTimeout(r, 0));

    // Fire a non-.bib file event
    const cb = listenerCallbacks.get("workspace://file-modified");
    expect(cb).toBeDefined();
    cb!({ payload: { path: "note.md" } });

    // Cache should NOT be invalidated -- same result from cache
    const dom2 = buildTooltipDom("k");
    await vi.waitFor(() => {
      expect(dom2.querySelector("button")).not.toBeNull();
    });
    // getBibKeyStates should only have been called once (cached)
    expect(getBibMock).toHaveBeenCalledTimes(1);

    view.destroy();
  });

  it("workspace://file-created on .bib file invalidates cache", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;

    const listenerCallbacks = new Map<string, (event: unknown) => void>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listenMock.mockImplementation(async (eventName: string, callback: any) => {
      listenerCallbacks.set(eventName, callback as (event: unknown) => void);
      return () => {};
    });

    getBibMock.mockResolvedValueOnce({ k: { materialization: "shadow" } });
    invalidateBibKeyStatesCache();
    const dom = buildTooltipDom("k");
    await vi.waitFor(() => {
      expect(dom.querySelector("button")).not.toBeNull();
    });

    const view = makeViewWithListener("test");
    await new Promise((r) => setTimeout(r, 0));

    const cb = listenerCallbacks.get("workspace://file-created");
    expect(cb).toBeDefined();
    cb!({ payload: { path: "new-refs.bib" } });

    getBibMock.mockResolvedValueOnce({ k: { materialization: "materialized", page_id: "k.md" } });
    const dom2 = buildTooltipDom("k");
    await vi.waitFor(() => {
      expect(dom2.querySelector("button")?.textContent).toBe("Open note");
    });
    expect(getBibMock).toHaveBeenCalledTimes(2);

    view.destroy();
  });

  it("workspace://file-deleted on .bib file invalidates cache", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;

    const listenerCallbacks = new Map<string, (event: unknown) => void>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listenMock.mockImplementation(async (eventName: string, callback: any) => {
      listenerCallbacks.set(eventName, callback as (event: unknown) => void);
      return () => {};
    });

    getBibMock.mockResolvedValueOnce({ k: { materialization: "shadow" } });
    invalidateBibKeyStatesCache();
    const dom = buildTooltipDom("k");
    await vi.waitFor(() => {
      expect(dom.querySelector("button")).not.toBeNull();
    });

    const view = makeViewWithListener("test");
    await new Promise((r) => setTimeout(r, 0));

    const cb = listenerCallbacks.get("workspace://file-deleted");
    expect(cb).toBeDefined();
    cb!({ payload: { path: "old-refs.BIB" } }); // case-insensitive

    getBibMock.mockResolvedValueOnce({ k: { materialization: "materialized", page_id: "k.md" } });
    const dom2 = buildTooltipDom("k");
    await vi.waitFor(() => {
      expect(dom2.querySelector("button")?.textContent).toBe("Open note");
    });
    expect(getBibMock).toHaveBeenCalledTimes(2);

    view.destroy();
  });

  it("workspace switch invalidates cache", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;

    // Prime the cache
    getBibMock.mockResolvedValueOnce({ k: { materialization: "shadow" } });
    invalidateBibKeyStatesCache();
    const dom = buildTooltipDom("k");
    await vi.waitFor(() => {
      expect(dom.querySelector("button")).not.toBeNull();
    });

    const view = makeViewWithListener("test");
    await new Promise((r) => setTimeout(r, 0));

    // Simulate workspace switch
    (useWorkspaceStore as unknown as { setState: (partial: Record<string, unknown>) => void }).setState({ workspacePath: "/vault/two" });

    // Cache should be invalidated -- next call triggers new IPC
    getBibMock.mockResolvedValueOnce({ k: { materialization: "materialized", page_id: "k.md" } });
    const dom2 = buildTooltipDom("k");
    await vi.waitFor(() => {
      expect(dom2.querySelector("button")?.textContent).toBe("Open note");
    });
    expect(getBibMock).toHaveBeenCalledTimes(2);

    view.destroy();
  });

  it("all listeners are cleaned up on destroy", async () => {
    const unlistenFns = new Map<string, ReturnType<typeof vi.fn>>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listenMock.mockImplementation(async (eventName: any) => {
      const fn = vi.fn();
      unlistenFns.set(eventName as string, fn);
      return fn;
    });

    const subscribeSpy = vi.mocked(useWorkspaceStore.subscribe);

    const view = makeViewWithListener("test");
    // Let all listen promises resolve
    await new Promise((r) => setTimeout(r, 0));

    view.destroy();

    // All Tauri event unlisteners should have been called
    for (const [, fn] of unlistenFns) {
      expect(fn).toHaveBeenCalledTimes(1);
    }

    // Workspace store subscription should have been cleaned up
    // The subscribe mock returns an unsub function; we need to check it was called
    expect(subscribeSpy).toHaveBeenCalled();
  });

  it("early destroy unregisters late-resolving workspace file listeners", async () => {
    const unlistenFns: ReturnType<typeof vi.fn>[] = [];
    const resolvers: ((fn: () => void) => void)[] = [];

    listenMock.mockImplementation(async () => {
      return new Promise<() => void>((resolve) => {
        resolvers.push(resolve);
      });
    });

    const view = makeViewWithListener("test");
    // Destroy immediately before any listen promise resolves
    view.destroy();

    // Resolve all pending listen promises
    for (const resolve of resolvers) {
      const fn = vi.fn();
      unlistenFns.push(fn);
      resolve(fn);
    }
    // Flush microtasks
    await new Promise((r) => setTimeout(r, 0));

    // All unlisten fns should have been called immediately upon resolution
    for (const fn of unlistenFns) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });
});

describe("F2: stale-create-note recovers on already-exists error", () => {
  const materializeAndOpenMockF2 = vi.mocked(materializeAndOpen);

  afterEach(() => {
    vi.restoreAllMocks();
    invalidateBibKeyStatesCache();
  });

  it("clicking Create note when note already exists navigates to existing page", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;

    // Stale cache says not materialized
    getBibMock.mockResolvedValueOnce({
      key1: { materialization: "shadow", page_id: null },
    });
    invalidateBibKeyStatesCache();

    const dom = buildTooltipDom("key1");
    await vi.waitFor(() => {
      const btn = dom.querySelector("button");
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toBe("Create note");
    });

    // materializeAndOpen rejects with "already exists" error
    materializeAndOpenMockF2.mockRejectedValueOnce(
      new Error("A page with citekey 'key1' already exists: key1.md"),
    );
    // Re-fetch returns the materialized state
    getBibMock.mockResolvedValueOnce({
      key1: { materialization: "materialized", page_id: "key1.md" },
    });

    dom.querySelector("button")!.click();

    // Wait for recovery -- selectPage should be called with the existing page
    await vi.waitFor(() => {
      const selectPage = useWorkspaceStore.getState().selectPage as ReturnType<typeof vi.fn>;
      expect(selectPage).toHaveBeenCalledWith("key1.md");
    });

    // No error toast should have been shown
    const show = useStatusMessageStore.getState().show as ReturnType<typeof vi.fn>;
    expect(show).not.toHaveBeenCalled();
  });

  it("clicking Create note with File already exists error also recovers gracefully", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;

    getBibMock.mockResolvedValueOnce({
      key1: { materialization: "shadow", page_id: null },
    });
    invalidateBibKeyStatesCache();

    const dom = buildTooltipDom("key1");
    await vi.waitFor(() => {
      expect(dom.querySelector("button")?.textContent).toBe("Create note");
    });

    // Different error message format
    materializeAndOpenMockF2.mockRejectedValueOnce(
      new Error("File already exists: citations/key1.md"),
    );
    getBibMock.mockResolvedValueOnce({
      key1: { materialization: "materialized", page_id: "key1.md" },
    });

    dom.querySelector("button")!.click();

    await vi.waitFor(() => {
      const selectPage = useWorkspaceStore.getState().selectPage as ReturnType<typeof vi.fn>;
      expect(selectPage).toHaveBeenCalledWith("key1.md");
    });
  });

  it("clicking Create note with non-exists error shows error toast", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;

    getBibMock.mockResolvedValueOnce({
      key1: { materialization: "shadow", page_id: null },
    });
    invalidateBibKeyStatesCache();

    const dom = buildTooltipDom("key1");
    await vi.waitFor(() => {
      expect(dom.querySelector("button")?.textContent).toBe("Create note");
    });

    materializeAndOpenMockF2.mockRejectedValueOnce(new Error("Graph index not ready"));

    dom.querySelector("button")!.click();

    await vi.waitFor(() => {
      const btn = dom.querySelector("button")!;
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe("Create note");
    });

    const show = useStatusMessageStore.getState().show as ReturnType<typeof vi.fn>;
    expect(show).toHaveBeenCalledWith(expect.stringContaining("Graph index not ready"), "error");
  });

  it("already-exists re-fetch resolves but page_id is missing shows toast and restores button", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;

    // Stale cache: shadow, no page_id
    getBibMock.mockResolvedValueOnce({
      key1: { materialization: "shadow", page_id: null },
    });
    invalidateBibKeyStatesCache();

    const dom = buildTooltipDom("key1");
    await vi.waitFor(() => {
      expect(dom.querySelector("button")?.textContent).toBe("Create note");
    });

    // materializeAndOpen rejects with "already exists"
    materializeAndOpenMockF2.mockRejectedValueOnce(
      new Error("A page with citekey 'key1' already exists: key1.md"),
    );
    // Re-fetch resolves but STILL has no page_id (graph index hasn't caught up)
    getBibMock.mockResolvedValueOnce({
      key1: { materialization: "shadow", page_id: null },
    });

    dom.querySelector("button")!.click();

    // Button should be restored and toast shown
    await vi.waitFor(() => {
      const btn = dom.querySelector("button")!;
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe("Create note");
    });

    const show = useStatusMessageStore.getState().show as ReturnType<typeof vi.fn>;
    expect(show).toHaveBeenCalledWith("Note exists but could not navigate to it", "error");
  });

  it("already-exists re-fetch resolves but key is entirely missing shows toast and restores button", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;

    getBibMock.mockResolvedValueOnce({
      key1: { materialization: "shadow", page_id: null },
    });
    invalidateBibKeyStatesCache();

    const dom = buildTooltipDom("key1");
    await vi.waitFor(() => {
      expect(dom.querySelector("button")?.textContent).toBe("Create note");
    });

    materializeAndOpenMockF2.mockRejectedValueOnce(
      new Error("File already exists: citations/key1.md"),
    );
    // Re-fetch resolves but key1 is not present at all
    getBibMock.mockResolvedValueOnce({});

    dom.querySelector("button")!.click();

    await vi.waitFor(() => {
      const btn = dom.querySelector("button")!;
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe("Create note");
    });

    const show = useStatusMessageStore.getState().show as ReturnType<typeof vi.fn>;
    expect(show).toHaveBeenCalledWith("Note exists but could not navigate to it", "error");
  });

  it("clicking Create note when already-exists re-fetch also fails shows fallback toast", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;

    getBibMock.mockResolvedValueOnce({
      key1: { materialization: "shadow", page_id: null },
    });
    invalidateBibKeyStatesCache();

    const dom = buildTooltipDom("key1");
    await vi.waitFor(() => {
      expect(dom.querySelector("button")?.textContent).toBe("Create note");
    });

    // materializeAndOpen rejects with "already exists"
    materializeAndOpenMockF2.mockRejectedValueOnce(
      new Error("A page with citekey 'key1' already exists: key1.md"),
    );
    // Re-fetch also fails
    getBibMock.mockRejectedValueOnce(new Error("IPC timeout"));

    dom.querySelector("button")!.click();

    await vi.waitFor(() => {
      const btn = dom.querySelector("button")!;
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe("Create note");
    });

    const show = useStatusMessageStore.getState().show as ReturnType<typeof vi.fn>;
    expect(show).toHaveBeenCalledWith("Note exists but could not navigate to it", "error");
  });
});

describe("F6: anchor-multikey — tooltip anchors per-key", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hover tracker stores lastHoveredElement when mouseover hits a key span", () => {
    const view = makeViewWithTracker("test document");
    const tracker = view.plugin(citeprocHoverTracker);
    expect(tracker).not.toBeNull();

    const keySpan = document.createElement("span");
    keySpan.className = "cm-crossref-citeproc-key";
    keySpan.dataset.citekey = "b";
    view.dom.appendChild(keySpan);

    keySpan.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(tracker!.lastHoveredElement).toBe(keySpan);

    view.dom.removeChild(keySpan);
    view.destroy();
  });

  it("hover tracker clears lastHoveredElement when mouseover target is not a key span", () => {
    const view = makeViewWithTracker("test document");
    const tracker = view.plugin(citeprocHoverTracker);
    expect(tracker).not.toBeNull();

    // Manually set an element
    const fakeSpan = document.createElement("span");
    (tracker as unknown as { lastHoveredElement: HTMLElement | null }).lastHoveredElement = fakeSpan;

    // Dispatch mouseover on a non-key-span element
    view.dom.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(tracker!.lastHoveredElement).toBeNull();
    view.destroy();
  });

  it("citeprocTooltipSource returns getCoords for multi-key citation when tracker has element", () => {
    const doc = "[@a; @b]";
    const view = makeViewWithTracker(doc);
    const tracker = view.plugin(citeprocHoverTracker);
    expect(tracker).not.toBeNull();

    tracker!.lastHoveredKey = "b";

    // Create a mock span with getBoundingClientRect
    const mockSpan = document.createElement("span");
    mockSpan.className = "cm-crossref-citeproc-key";
    mockSpan.dataset.citekey = "b";
    // Attach to document.body so isConnected is true (jsdom requires this)
    document.body.appendChild(view.dom);
    view.dom.appendChild(mockSpan);
    vi.spyOn(mockSpan, "getBoundingClientRect").mockReturnValue({
      left: 100, right: 150, top: 200, bottom: 220,
      width: 50, height: 20, x: 100, y: 200, toJSON: () => {},
    });
    (tracker as unknown as { lastHoveredElement: HTMLElement | null }).lastHoveredElement = mockSpan;

    const result = citeprocTooltipSource(view, 0, 1);
    expect(result).not.toBeNull();

    const tooltipView = result!.create!(view);
    expect(tooltipView.getCoords).toBeDefined();
    expect(typeof tooltipView.getCoords).toBe("function");

    const coords = tooltipView.getCoords!(0);
    expect(coords).toEqual({ left: 100, right: 150, top: 200, bottom: 220 });

    view.dom.removeChild(mockSpan);
    document.body.removeChild(view.dom);
    view.destroy();
  });

  it("citeprocTooltipSource omits getCoords when tracker has no element (fallback)", () => {
    const doc = "[@a; @b]";
    const view = makeViewWithTracker(doc);
    const tracker = view.plugin(citeprocHoverTracker);
    expect(tracker).not.toBeNull();

    tracker!.lastHoveredKey = null;
    (tracker as unknown as { lastHoveredElement: HTMLElement | null }).lastHoveredElement = null;

    const result = citeprocTooltipSource(view, 0, 1);
    expect(result).not.toBeNull();

    const tooltipView = result!.create!(view);
    expect(tooltipView.getCoords).toBeUndefined();

    view.destroy();
  });

  it("citeprocTooltipSource omits getCoords when element citekey does not match resolved key", () => {
    const doc = "[@a; @b]";
    const view = makeViewWithTracker(doc);
    const tracker = view.plugin(citeprocHoverTracker);
    expect(tracker).not.toBeNull();

    tracker!.lastHoveredKey = "a";

    // Element has a mismatched citekey
    const staleSpan = document.createElement("span");
    staleSpan.className = "cm-crossref-citeproc-key";
    staleSpan.dataset.citekey = "z"; // does NOT match resolved key "a"
    view.dom.appendChild(staleSpan);
    (tracker as unknown as { lastHoveredElement: HTMLElement | null }).lastHoveredElement = staleSpan;

    const result = citeprocTooltipSource(view, 0, 1);
    expect(result).not.toBeNull();

    const tooltipView = result!.create!(view);
    expect(tooltipView.getCoords).toBeUndefined();

    view.dom.removeChild(staleSpan);
    view.destroy();
  });
});

describe("F7: materialize-and-open shared helper", () => {
  const materializeAndOpenMock = vi.mocked(materializeAndOpen);
  const getCurrentEditorViewMock = vi.mocked(getCurrentEditorView);
  const recordJumpSpy = vi.mocked(globalJumpTracker.recordJump);

  afterEach(() => {
    vi.restoreAllMocks();
    invalidateBibKeyStatesCache();
    (useWorkspaceStore as unknown as { _resetForTest: () => void })._resetForTest();
  });

  it("Create note click calls materializeAndOpen with recordDeparture", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;

    getBibMock.mockResolvedValueOnce({
      key1: { materialization: "shadow", page_id: null },
    });
    materializeAndOpenMock.mockResolvedValueOnce({
      title: "Key1",
      relative_path: "key1.md",
      frontmatter: {},
      created_at: null,
      modified_at: null,
      file_type: "markdown",
      has_companion: false,
    });
    invalidateBibKeyStatesCache();

    const dom = buildTooltipDom("key1");
    await vi.waitFor(() => {
      const btn = dom.querySelector("button");
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toBe("Create note");
    });

    dom.querySelector("button")!.click();

    await vi.waitFor(() => {
      expect(materializeAndOpenMock).toHaveBeenCalledTimes(1);
      expect(materializeAndOpenMock).toHaveBeenCalledWith(
        "key1",
        expect.objectContaining({ recordDeparture: expect.any(Function) }),
      );
    });
  });

  it("Create note click records departure via globalJumpTracker when editor view is available", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;

    // Set up a mock editor view with selection state
    const mockDoc = {
      lineAt: vi.fn((_pos: number) => ({ number: 5, from: 40 })),
    };
    const mockView = {
      state: {
        selection: { main: { head: 42 } },
        doc: mockDoc,
      },
    };
    getCurrentEditorViewMock.mockReturnValue(mockView as unknown as import("@codemirror/view").EditorView);

    getBibMock.mockResolvedValueOnce({
      key1: { materialization: "shadow", page_id: null },
    });

    // Capture the recordDeparture callback and call it
    materializeAndOpenMock.mockImplementation(async (_bibKey, opts) => {
      opts?.recordDeparture?.();
      return {
        title: "Key1",
        relative_path: "key1.md",
        frontmatter: {},
        created_at: null,
        modified_at: null,
        file_type: "markdown",
        has_companion: false,
      };
    });
    invalidateBibKeyStatesCache();

    const dom = buildTooltipDom("key1");
    await vi.waitFor(() => {
      const btn = dom.querySelector("button");
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toBe("Create note");
    });

    dom.querySelector("button")!.click();

    await vi.waitFor(() => {
      expect(recordJumpSpy).toHaveBeenCalledWith(
        { notePath: "note.md", line: 5, col: 2 },
        { notePath: "", line: 0, col: 0 },
      );
    });
  });

  it("Create note click invalidates bib key states cache after materializeAndOpen resolves", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;

    // First call: shadow
    getBibMock.mockResolvedValueOnce({
      key1: { materialization: "shadow", page_id: null },
    });
    materializeAndOpenMock.mockResolvedValueOnce({
      title: "Key1",
      relative_path: "key1.md",
      frontmatter: {},
      created_at: null,
      modified_at: null,
      file_type: "markdown",
      has_companion: false,
    });
    invalidateBibKeyStatesCache();

    const dom = buildTooltipDom("key1");
    await vi.waitFor(() => {
      expect(dom.querySelector("button")?.textContent).toBe("Create note");
    });

    dom.querySelector("button")!.click();

    await vi.waitFor(() => {
      expect(materializeAndOpenMock).toHaveBeenCalledTimes(1);
    });
    // Flush microtasks to let the .then run
    await new Promise((r) => setTimeout(r, 0));

    // Cache was invalidated, so next buildTooltipDom triggers a fresh getBibKeyStates
    getBibMock.mockResolvedValueOnce({
      key1: { materialization: "materialized", page_id: "key1.md" },
    });
    const dom2 = buildTooltipDom("key1");
    await vi.waitFor(() => {
      expect(dom2.querySelector("button")?.textContent).toBe("Open note");
    });
    // getBibKeyStates should have been called twice (cache was busted)
    expect(getBibMock).toHaveBeenCalledTimes(2);
  });

  it("Create note click eagerly appends page to workspace store via materializeAndOpen", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;

    getBibMock.mockResolvedValueOnce({
      key1: { materialization: "shadow", page_id: null },
    });

    const setStateSpy = vi.mocked(useWorkspaceStore.setState);

    // Let materializeAndOpen actually call setState via the real implementation pattern
    materializeAndOpenMock.mockImplementation(async () => {
      const meta = {
        title: "Key1",
        relative_path: "key1.md",
        frontmatter: {},
        created_at: null,
        modified_at: null,
        file_type: "markdown" as const,
        has_companion: false,
      };
      // The real materializeAndOpen calls setState -- we verify it was called
      (useWorkspaceStore.setState as ReturnType<typeof vi.fn>)(
        () => ({ pages: [meta] }),
      );
      return meta;
    });
    invalidateBibKeyStatesCache();

    const dom = buildTooltipDom("key1");
    await vi.waitFor(() => {
      expect(dom.querySelector("button")?.textContent).toBe("Create note");
    });

    dom.querySelector("button")!.click();

    await vi.waitFor(() => {
      expect(setStateSpy).toHaveBeenCalled();
    });
  });
});

describe("C3: dedupe-global-listeners", () => {
  const listenMock = vi.mocked(listen);

  afterEach(() => {
    vi.restoreAllMocks();
    invalidateBibKeyStatesCache();
    _resetSharedListenersForTest();
  });

  it("first acquire registers 4 Tauri listeners and 1 workspace subscription", () => {
    const subscribeSpy = vi.mocked(useWorkspaceStore.subscribe);
    subscribeSpy.mockClear();
    listenMock.mockClear();

    acquireInvalidationListeners();

    expect(listenMock).toHaveBeenCalledTimes(4);
    expect(listenMock).toHaveBeenCalledWith("lit:graph-updated", expect.any(Function));
    expect(listenMock).toHaveBeenCalledWith("workspace://file-created", expect.any(Function));
    expect(listenMock).toHaveBeenCalledWith("workspace://file-modified", expect.any(Function));
    expect(listenMock).toHaveBeenCalledWith("workspace://file-deleted", expect.any(Function));
    expect(subscribeSpy).toHaveBeenCalledTimes(1);

    releaseInvalidationListeners();
  });

  it("second acquire does NOT register additional listeners", () => {
    const subscribeSpy = vi.mocked(useWorkspaceStore.subscribe);
    subscribeSpy.mockClear();
    listenMock.mockClear();

    acquireInvalidationListeners();
    acquireInvalidationListeners();

    expect(listenMock).toHaveBeenCalledTimes(4);
    expect(subscribeSpy).toHaveBeenCalledTimes(1);

    releaseInvalidationListeners();
    releaseInvalidationListeners();
  });

  it("first release does not tear down listeners when refcount > 0", async () => {
    const unlistenFns: ReturnType<typeof vi.fn>[] = [];
    listenMock.mockImplementation(async () => {
      const fn = vi.fn();
      unlistenFns.push(fn);
      return fn;
    });

    acquireInvalidationListeners();
    acquireInvalidationListeners();

    // Flush microtasks so listen promises resolve
    await new Promise((r) => setTimeout(r, 0));

    releaseInvalidationListeners(); // refcount goes from 2 to 1

    // No unlisteners should have been called yet
    for (const fn of unlistenFns) {
      expect(fn).not.toHaveBeenCalled();
    }

    releaseInvalidationListeners(); // refcount goes from 1 to 0 -- cleanup
  });

  it("last release tears down all listeners and workspace subscription", async () => {
    const unlistenFns: ReturnType<typeof vi.fn>[] = [];
    listenMock.mockImplementation(async () => {
      const fn = vi.fn();
      unlistenFns.push(fn);
      return fn;
    });

    acquireInvalidationListeners();
    acquireInvalidationListeners();

    // Flush microtasks so listen promises resolve
    await new Promise((r) => setTimeout(r, 0));

    releaseInvalidationListeners(); // refcount 2 -> 1
    releaseInvalidationListeners(); // refcount 1 -> 0

    for (const fn of unlistenFns) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it("late-resolving listen after last release immediately unlistens", async () => {
    const unlistenFn = vi.fn();
    let resolveListenPromise!: (fn: () => void) => void;
    listenMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveListenPromise = resolve;
        }),
    );

    acquireInvalidationListeners();
    releaseInvalidationListeners(); // refcount drops to 0

    // Resolve the listen promise after release
    resolveListenPromise(unlistenFn);
    await new Promise((r) => setTimeout(r, 0));

    expect(unlistenFn).toHaveBeenCalledTimes(1);
  });

  it("late-resolving listen from previous generation immediately unlistens even if new acquire happened", async () => {
    const gen1Resolvers: ((fn: () => void) => void)[] = [];
    let callCount = 0;

    listenMock.mockImplementation(() => {
      callCount++;
      if (callCount <= 4) {
        // First generation: controllable promises
        return new Promise((resolve) => {
          gen1Resolvers.push(resolve);
        });
      }
      // Second generation: resolve immediately
      return Promise.resolve(() => {});
    });

    acquireInvalidationListeners(); // gen 1
    releaseInvalidationListeners(); // refcount 0, sharedDestroyed = true

    acquireInvalidationListeners(); // gen 2, sharedDestroyed = false
    await new Promise((r) => setTimeout(r, 0)); // let gen 2 promises resolve

    // Now resolve gen-1 listen promises
    const gen1UnlistenFns: ReturnType<typeof vi.fn>[] = [];
    for (const resolve of gen1Resolvers) {
      const fn = vi.fn();
      gen1UnlistenFns.push(fn);
      resolve(fn);
    }
    await new Promise((r) => setTimeout(r, 0));

    // Gen-1 unlisteners should have been called immediately (generation mismatch)
    for (const fn of gen1UnlistenFns) {
      expect(fn).toHaveBeenCalledTimes(1);
    }

    releaseInvalidationListeners(); // clean up gen 2
  });

  it("two EditorViews share one set of listeners", async () => {
    const unlistenFns: ReturnType<typeof vi.fn>[] = [];
    listenMock.mockImplementation(async () => {
      const fn = vi.fn();
      unlistenFns.push(fn);
      return fn;
    });

    function makeViewWithListener(doc: string): EditorView {
      const state = EditorState.create({
        doc,
        extensions: [citeprocMatchesField, citeprocTooltipExtension()],
      });
      return trackView(new EditorView({ state, parent: document.createElement("div") }));
    }

    const view1 = makeViewWithListener("test1");
    const view2 = makeViewWithListener("test2");

    // Flush microtasks
    await new Promise((r) => setTimeout(r, 0));

    // Only 4 listeners registered total (not 8)
    expect(unlistenFns.length).toBe(4);

    view1.destroy();
    // After first destroy, listeners should still be active
    for (const fn of unlistenFns) {
      expect(fn).not.toHaveBeenCalled();
    }

    view2.destroy();
    // After second destroy, all listeners should be cleaned up
    for (const fn of unlistenFns) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it("invalidation still works through shared listeners", async () => {
    const { getBibKeyStates } = await import("../../lib/ipc");
    const getBibMock = getBibKeyStates as ReturnType<typeof vi.fn>;

    const listenerCallbacks = new Map<string, (event: unknown) => void>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listenMock.mockImplementation(async (eventName: string, callback: any) => {
      listenerCallbacks.set(eventName, callback as (event: unknown) => void);
      return () => {};
    });

    // Prime the cache
    getBibMock.mockResolvedValueOnce({ k: { materialization: "shadow" } });
    invalidateBibKeyStatesCache();
    const dom = buildTooltipDom("k");
    await vi.waitFor(() => {
      expect(dom.querySelector("button")).not.toBeNull();
    });

    acquireInvalidationListeners();
    await new Promise((r) => setTimeout(r, 0));

    // Fire a .bib file-modified event through the shared listener
    const cb = listenerCallbacks.get("workspace://file-modified");
    expect(cb).toBeDefined();
    cb!({ payload: { path: "refs.bib" } });

    // Cache should be invalidated
    getBibMock.mockResolvedValueOnce({ k: { materialization: "materialized", page_id: "k.md" } });
    const dom2 = buildTooltipDom("k");
    await vi.waitFor(() => {
      expect(dom2.querySelector("button")?.textContent).toBe("Open note");
    });
    expect(getBibMock).toHaveBeenCalledTimes(2);

    releaseInvalidationListeners();
  });
});

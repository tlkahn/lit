import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMarkConfigStore } from "./markConfig";

vi.mock("../lib/ipc", () => ({
  getMarkConfig: vi.fn(),
}));

vi.mock("../editor/livePreview/markStyles", () => ({
  injectMarkStyles: vi.fn(),
}));

import { getMarkConfig } from "../lib/ipc";
import { injectMarkStyles } from "../editor/livePreview/markStyles";

const mockedGetMarkConfig = getMarkConfig as ReturnType<typeof vi.fn>;
const mockedInjectMarkStyles = injectMarkStyles as ReturnType<typeof vi.fn>;

describe("markConfig store", () => {
  beforeEach(() => {
    useMarkConfigStore.setState({ config: {}, loaded: false });
    vi.clearAllMocks();
  });

  it("initial state is empty and not loaded", () => {
    const s = useMarkConfigStore.getState();
    expect(s.config).toEqual({});
    expect(s.loaded).toBe(false);
  });

  it("loadConfig populates the cache and sets loaded", async () => {
    mockedGetMarkConfig.mockResolvedValue({
      nb: { label: "nota bene", icon: "B", style: { "font-weight": "bold" } },
    });
    await useMarkConfigStore.getState().loadConfig();
    const s = useMarkConfigStore.getState();
    expect(s.config.nb!.label).toBe("nota bene");
    expect(s.loaded).toBe(true);
    expect(mockedGetMarkConfig).toHaveBeenCalledTimes(1);
  });

  it("loadConfig injects the dynamic mark stylesheet from the loaded config", async () => {
    const config = {
      nb: { label: "nota bene", icon: "B", style: { "font-weight": "bold" } },
    };
    mockedGetMarkConfig.mockResolvedValue(config);
    await useMarkConfigStore.getState().loadConfig();
    expect(mockedInjectMarkStyles).toHaveBeenCalledTimes(1);
    expect(mockedInjectMarkStyles).toHaveBeenCalledWith(config);
  });

  it("getDef returns the def for a known code and undefined for an unknown one", async () => {
    mockedGetMarkConfig.mockResolvedValue({
      nb: { label: "nota bene", icon: "B", style: { "font-weight": "bold" } },
    });
    await useMarkConfigStore.getState().loadConfig();
    expect(useMarkConfigStore.getState().getDef("nb")?.icon).toBe("B");
    expect(useMarkConfigStore.getState().getDef("zzz")).toBeUndefined();
  });

  it("loadConfig refreshes the cache from the latest IPC result", async () => {
    mockedGetMarkConfig.mockResolvedValueOnce({ nb: { label: "nota bene" } });
    await useMarkConfigStore.getState().loadConfig();
    mockedGetMarkConfig.mockResolvedValueOnce({ sic: { label: "sic erat scriptum" } });
    await useMarkConfigStore.getState().loadConfig();
    const s = useMarkConfigStore.getState();
    expect(s.getDef("sic")?.label).toBe("sic erat scriptum");
    expect(s.getDef("nb")).toBeUndefined();
    expect(mockedGetMarkConfig).toHaveBeenCalledTimes(2);
  });

  it("loadConfig IPC rejection is non-fatal", async () => {
    mockedGetMarkConfig.mockRejectedValue(new Error("IPC error"));
    await expect(useMarkConfigStore.getState().loadConfig()).resolves.toBeUndefined();
    const s = useMarkConfigStore.getState();
    expect(s.config).toEqual({});
    expect(s.loaded).toBe(false);
    expect(mockedInjectMarkStyles).not.toHaveBeenCalled();
  });
});

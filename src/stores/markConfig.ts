import { create } from "zustand";
import type { MarkConfig, MarkDef } from "../lib/ipc";
import { getMarkConfig } from "../lib/ipc";
import { injectMarkStyles } from "../editor/livePreview/markStyles";

export interface MarkConfigStore {
  config: MarkConfig;
  loaded: boolean;
  loadConfig: () => Promise<void>;
  getDef: (code: string) => MarkDef | undefined;
}

export const useMarkConfigStore = create<MarkConfigStore>((set, get) => ({
  config: {},
  loaded: false,

  loadConfig: async () => {
    try {
      const config = await getMarkConfig();
      set({ config, loaded: true });
      // Mirror the theme store: emit the dynamic <style> for custom/overridden
      // marks alongside the state update, so callers only call loadConfig().
      injectMarkStyles(config);
    } catch {
      // IPC unavailable (tests, plain browser dev)
    }
  },

  getDef: (code: string) => get().config[code],
}));

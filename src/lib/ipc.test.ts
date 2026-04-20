import { describe, it, expect, beforeEach } from "vitest";
import { mockInvoke } from "../test/tauri-mock";
import { getAppInfo } from "./ipc";

describe("ipc", () => {
  beforeEach(() => {
    mockInvoke((cmd) => {
      if (cmd === "get_app_info") {
        return { name: "Lit", version: "0.1.0" };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  it("getAppInfo returns name and version", async () => {
    const info = await getAppInfo();
    expect(info).toEqual({ name: "Lit", version: "0.1.0" });
  });

  it("getAppInfo calls the correct command", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await getAppInfo();
    expect(invoke).toHaveBeenCalledWith("get_app_info");
  });
});

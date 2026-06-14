import { describe, it, expect, beforeEach } from "vitest";
import { _clear, hasCommand, getVisibleCommands } from "../commandRegistry";
import { initOcrCommands } from "./ocr";

describe("initOcrCommands", () => {
  beforeEach(() => {
    _clear();
  });

  it("registers ocr.toMarkdown", () => {
    initOcrCommands();
    expect(hasCommand("ocr.toMarkdown")).toBe(true);
  });

  it("is idempotent via registerOnce", () => {
    initOcrCommands();
    initOcrCommands();
    const cmds = getVisibleCommands("ocr");
    const ocrCmds = cmds.filter((c) => c.id === "ocr.toMarkdown");
    expect(ocrCmds).toHaveLength(1);
  });

  it("has correct metadata", () => {
    initOcrCommands();
    const cmds = getVisibleCommands("ocr");
    const ocrCmd = cmds.find((c) => c.id === "ocr.toMarkdown");
    expect(ocrCmd).toBeDefined();
    expect(ocrCmd!.label).toBe("OCR to Markdown");
    expect(ocrCmd!.keywords).toContain("pdf");
    expect(ocrCmd!.keywords).toContain("markdown");
  });

  it("action does not throw", () => {
    initOcrCommands();
    const cmds = getVisibleCommands("ocr");
    const ocrCmd = cmds.find((c) => c.id === "ocr.toMarkdown");
    expect(() => ocrCmd!.action()).not.toThrow();
  });
});

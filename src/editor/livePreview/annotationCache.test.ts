import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAnnotationCached, parseAnnotationAsync, clearAnnotationCache } from "./annotationCache";

vi.mock("../../lib/ipc", () => ({
  parseAnnotations: vi.fn(async (content: string) => [
    {
      form: "compact",
      annotation_type: "note",
      certainty: "neutral",
      scope: { kind: "words", value: 0 },
      body: "test body",
      date: null,
      is_structured: true,
      char_start: 0,
      char_end: content.length,
      original: content,
    },
  ]),
}));

beforeEach(() => {
  clearAnnotationCache();
});

describe("annotationCache", () => {
  it("getAnnotationCached returns undefined on cache miss", () => {
    expect(getAnnotationCached("%%!n | test%%")).toBeUndefined();
  });

  it("parseAnnotationAsync populates cache", async () => {
    const text = "%%!n | some note%%";
    const result = await parseAnnotationAsync(text);
    expect(result).toHaveLength(1);
    expect(result[0]!.annotation_type).toBe("note");
    expect(getAnnotationCached(text)).toEqual(result);
  });

  it("different keys have independent entries", async () => {
    await parseAnnotationAsync("%%!n | a%%");
    await parseAnnotationAsync("%%!q | b%%");
    expect(getAnnotationCached("%%!n | a%%")).toBeDefined();
    expect(getAnnotationCached("%%!q | b%%")).toBeDefined();
    expect(getAnnotationCached("%%!n | a%%")).not.toEqual(getAnnotationCached("%%!q | b%%"));
  });

  it("clearAnnotationCache empties the cache", async () => {
    await parseAnnotationAsync("%%!n | x%%");
    clearAnnotationCache();
    expect(getAnnotationCached("%%!n | x%%")).toBeUndefined();
  });

  it("IPC rejection propagates error", async () => {
    const ipc = await import("../../lib/ipc");
    vi.mocked(ipc.parseAnnotations).mockRejectedValueOnce(new Error("IPC fail"));
    await expect(parseAnnotationAsync("bad")).rejects.toThrow("IPC fail");
    expect(getAnnotationCached("bad")).toBeUndefined();
  });
});

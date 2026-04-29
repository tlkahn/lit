import { describe, it, expect, vi, beforeEach } from "vitest";
import { getKatexSync, loadKatex, resetKatexLoader } from "./katexLoader";

const mockKatex = {
  render: vi.fn(),
  renderToString: vi.fn((tex: string) => `<span class="katex">${tex}</span>`),
};

vi.mock("katex", () => ({ default: mockKatex }));

beforeEach(() => {
  resetKatexLoader();
});

describe("katexLoader", () => {
  it("getKatexSync returns null before loading", () => {
    expect(getKatexSync()).toBeNull();
  });

  it("loadKatex returns the katex module", async () => {
    const katex = await loadKatex();
    expect(katex).toBe(mockKatex);
  });

  it("getKatexSync returns the module after loadKatex resolves", async () => {
    expect(getKatexSync()).toBeNull();
    await loadKatex();
    expect(getKatexSync()).toBe(mockKatex);
  });

  it("multiple loadKatex calls reuse the same promise", async () => {
    const p1 = loadKatex();
    const p2 = loadKatex();
    expect(p1).toBe(p2);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
  });

  it("resetKatexLoader clears cached module", async () => {
    await loadKatex();
    expect(getKatexSync()).not.toBeNull();
    resetKatexLoader();
    expect(getKatexSync()).toBeNull();
  });

  it("loadKatex after reset re-imports", async () => {
    await loadKatex();
    resetKatexLoader();
    const katex = await loadKatex();
    expect(katex).toBe(mockKatex);
  });
});

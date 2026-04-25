import { describe, it, expect, afterEach } from "vitest";
import { showMediaLightbox } from "./lightbox";

function getLightbox() {
  return document.querySelector(".cm-media-lightbox");
}

afterEach(() => {
  getLightbox()?.remove();
});

describe("showMediaLightbox", () => {
  it("appends backdrop to document.body", () => {
    showMediaLightbox({ type: "image", src: "test.png" });
    expect(getLightbox()).not.toBeNull();
  });

  it("renders img for image type with correct src", () => {
    showMediaLightbox({ type: "image", src: "photo.jpg" });
    const img = getLightbox()!.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.src).toContain("photo.jpg");
  });

  it("renders SVG content for svg type", () => {
    showMediaLightbox({ type: "svg", svg: "<svg><circle r='5'/></svg>" });
    const svg = getLightbox()!.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("closes on ESC key", () => {
    showMediaLightbox({ type: "image", src: "test.png" });
    expect(getLightbox()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(getLightbox()).toBeNull();
  });

  it("closes on backdrop click", () => {
    showMediaLightbox({ type: "image", src: "test.png" });
    const backdrop = getLightbox()!;
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(getLightbox()).toBeNull();
  });

  it("does not close on content click", () => {
    showMediaLightbox({ type: "image", src: "test.png" });
    const inner = getLightbox()!.firstElementChild!;
    inner.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(getLightbox()).not.toBeNull();
  });

  it("removes ESC listener after close", () => {
    showMediaLightbox({ type: "image", src: "test.png" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(getLightbox()).toBeNull();
    // Second ESC should not throw
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });

  it("only one lightbox at a time", () => {
    showMediaLightbox({ type: "image", src: "first.png" });
    showMediaLightbox({ type: "image", src: "second.png" });
    const all = document.querySelectorAll(".cm-media-lightbox");
    expect(all).toHaveLength(1);
    const img = all[0]!.querySelector("img");
    expect(img!.src).toContain("second.png");
  });
});

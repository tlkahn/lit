import { test, expect, type Page, type Locator } from "@playwright/test";

const URL = "/e2e/cardbox-flip-harness.html";

function card(page: Page, id: string): Locator {
  return page.locator(`#${id} [data-testid="cardbox-card"]`);
}

function rotator(page: Page, id: string): Locator {
  return page.locator(`#${id} .cardbox-card-rotator`);
}

function flipBtn(page: Page, id: string): Locator {
  return page.locator(`#${id} [data-testid="card-flip"]`);
}

function parseMatrix3d(raw: string): number[] | null {
  const m = raw.match(/^matrix3d\((.+)\)$/);
  if (!m) return null;
  return m[1].split(",").map((s) => parseFloat(s.trim()));
}

test.describe("CSS 3D Transform Mechanics", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await page.waitForSelector("[data-testid='cardbox-card']");
  });

  test("unflipped rotator has no transform", async ({ page }) => {
    const transform = await rotator(page, "card-a").evaluate(
      (el) => getComputedStyle(el).transform,
    );
    expect(transform).toBe("none");
  });

  test("flip button applies rotateY(180deg) to rotator", async ({ page }) => {
    await flipBtn(page, "card-a").click();

    // Wait for the 0.4s CSS transition to finish
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const el = document.querySelector("#card-a .cardbox-card-rotator");
          if (!el) { resolve(); return; }
          el.addEventListener("transitionend", () => resolve(), { once: true });
          setTimeout(() => resolve(), 600);
        }),
    );

    const transform = await rotator(page, "card-a").evaluate(
      (el) => getComputedStyle(el).transform,
    );
    const vals = parseMatrix3d(transform);
    expect(vals).not.toBeNull();
    expect(vals![0]).toBeCloseTo(-1, 1); // m11
    expect(vals![10]).toBeCloseTo(-1, 1); // m33
  });

  test("backface-visibility is hidden on both faces", async ({ page }) => {
    const results = await page.evaluate(() => {
      const faces = document.querySelectorAll("#card-a .cardbox-card-face");
      return Array.from(faces).map(
        (el) => getComputedStyle(el).backfaceVisibility,
      );
    });
    expect(results.length).toBe(2);
    for (const v of results) {
      expect(v).toBe("hidden");
    }
  });

  test("perspective is set on scene container", async ({ page }) => {
    const perspective = await page.evaluate(() => {
      const el = document.querySelector("#card-a .cardbox-card-scene");
      return el ? getComputedStyle(el).perspective : null;
    });
    expect(perspective).toBe("1000px");
  });

  test("back face has base rotateY(180deg) transform", async ({ page }) => {
    const transform = await page.evaluate(() => {
      const el = document.querySelector(
        "#card-a .cardbox-card-face-back",
      );
      return el ? getComputedStyle(el).transform : null;
    });
    const vals = parseMatrix3d(transform!);
    expect(vals).not.toBeNull();
    expect(vals![0]).toBeCloseTo(-1, 1);
    expect(vals![10]).toBeCloseTo(-1, 1);
  });
});

test.describe("Animation & Reduced Motion", () => {
  test("flip fires transitionend event", async ({ page }) => {
    await page.goto(URL);
    await page.waitForSelector("[data-testid='cardbox-card']");

    const fired = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const el = document.querySelector("#card-a .cardbox-card-rotator");
        if (!el) { resolve(false); return; }
        el.addEventListener("transitionend", () => resolve(true), { once: true });
        setTimeout(() => resolve(false), 600);
        const btn = document.querySelector<HTMLButtonElement>(
          '#card-a [data-testid="card-flip"]',
        );
        btn?.click();
      });
    });
    expect(fired).toBe(true);
  });

  test("prefers-reduced-motion disables transition", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(URL);
    await page.waitForSelector("[data-testid='cardbox-card']");

    const duration = await rotator(page, "card-a").evaluate(
      (el) => getComputedStyle(el).transitionDuration,
    );
    expect(duration).toBe("0s");
  });
});

test.describe("Keyboard in Real Browser", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await page.waitForSelector("[data-testid='cardbox-card']");
  });

  test("F key flips focused card", async ({ page }) => {
    await card(page, "card-a").focus();
    await page.keyboard.press("f");

    await expect(card(page, "card-a")).toHaveAttribute("data-flipped", "true");
    const transform = await rotator(page, "card-a").evaluate(
      (el) => getComputedStyle(el).transform,
    );
    expect(transform).not.toBe("none");
  });

  test("F key ignored on card without original", async ({ page }) => {
    await card(page, "card-c").focus();
    await page.keyboard.press("f");

    await expect(card(page, "card-c")).toHaveAttribute("data-flipped", "false");
  });

  test("F key with modifier does not flip", async ({ page }) => {
    await card(page, "card-a").focus();
    await page.keyboard.press("Control+f");

    await expect(card(page, "card-a")).toHaveAttribute("data-flipped", "false");
  });
});

test.describe("Multi-card Independence", () => {
  test("flipping one card does not affect others", async ({ page }) => {
    await page.goto(URL);
    await page.waitForSelector("[data-testid='cardbox-card']");

    await flipBtn(page, "card-a").click();
    await expect(card(page, "card-a")).toHaveAttribute("data-flipped", "true");

    const bTransform = await rotator(page, "card-b").evaluate(
      (el) => getComputedStyle(el).transform,
    );
    expect(bTransform).toBe("none");
    await expect(card(page, "card-b")).toHaveAttribute("data-flipped", "false");
  });
});

test.describe("Flip + Expand Interaction", () => {
  test("expanded chrome stays on front when flipped", async ({ page }) => {
    await page.goto(URL);
    await page.waitForSelector("[data-testid='cardbox-card']");

    await card(page, "card-a").click();
    await expect(card(page, "card-a")).toHaveAttribute("data-expanded", "true");

    await flipBtn(page, "card-a").click();
    await expect(card(page, "card-a")).toHaveAttribute("data-flipped", "true");

    const navigateInFront = await page.evaluate(() => {
      const front = document.querySelector(
        '#card-a [data-testid="card-face-front"]',
      );
      return front?.querySelector('[data-testid="card-navigate"]') !== null;
    });
    expect(navigateInFront).toBe(true);
  });
});

test.describe("Pointer Events", () => {
  test("unflipped expanded front navigate receives the click", async ({ page }) => {
    await page.goto(URL);
    await page.waitForSelector("[data-testid='cardbox-card']");
    await card(page, "card-a").click();
    await expect(card(page, "card-a")).toHaveAttribute("data-expanded", "true");
    await page.locator("#card-a [data-testid='card-navigate']").click();
    const clicks = await page.evaluate(() => (window as any).__navClicks ?? 0);
    expect(clicks).toBe(1);
    await expect(card(page, "card-a")).toHaveAttribute("data-flipped", "false");
  });
});

test.describe("Height Model", () => {
  test("unflipped card height follows front, not long back quote", async ({ page }) => {
    await page.goto(URL);
    await page.waitForSelector("#card-long-quote [data-testid='cardbox-card']");
    const heights = await page.evaluate(() => {
      const root = document.querySelector("#card-long-quote [data-testid='cardbox-card']")!;
      const front = root.querySelector("[data-testid='card-face-front']") as HTMLElement;
      const back = root.querySelector("[data-testid='card-face-back']") as HTMLElement;
      const rotator = root.querySelector(".cardbox-card-rotator") as HTMLElement;
      return {
        root: root.getBoundingClientRect().height,
        front: front.getBoundingClientRect().height,
        back: back.scrollHeight,
        rotator: rotator.getBoundingClientRect().height,
        flipped: root.getAttribute("data-flipped"),
      };
    });
    expect(heights.flipped).toBe("false");
    expect(heights.back).toBeGreaterThan(heights.front * 2);
    expect(heights.rotator).toBeLessThanOrEqual(heights.front + 1);
    expect(heights.root).toBeLessThan(heights.back);
  });
});

test.describe("No-original Negative Case", () => {
  test("card without original has no flip button or back face", async ({
    page,
  }) => {
    await page.goto(URL);
    await page.waitForSelector("[data-testid='cardbox-card']");

    await expect(
      page.locator('#card-c [data-testid="card-flip"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('#card-c [data-testid="card-face-back"]'),
    ).toHaveCount(0);
  });
});

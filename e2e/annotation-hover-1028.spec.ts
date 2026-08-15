import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const HARNESS_URL = "/e2e/annotation-hover-1028-harness.html";

// Minimal Tauri IPC stub covering the commands the editor invokes. The doc
// matches the harness's fixed fixture; resolve mimics the real Rust
// resolve_annotation_scope for this doc (sentence-1 backward resolution):
//   ann1 (char_start 32) -> {0, 30}   "First term alpha appears here."
//   ann2 (char_start 109) -> {77, 107} "Second term beta appears here."
const STUB = `(function () {
  const DOC = "First term alpha appears here.\\n\\n<!--- n: ^\\"alpha\\"\\n---\\nnote about alpha\\n--->\\n\\nSecond term beta appears here.\\n\\n<!--- n: ^\\"beta\\"\\n---\\nnote about beta\\n--->";
  const ANN1_START = DOC.indexOf('<!--- n: ^"alpha"');
  const ANN1_END = ANN1_START + '<!--- n: ^"alpha"\\n---\\nnote about alpha\\n--->'.length;
  const ANN2_START = DOC.indexOf('<!--- n: ^"beta"');
  const ANN2_END = ANN2_START + '<!--- n: ^"beta"\\n---\\nnote about beta\\n--->'.length;

  function parseAnnotations() {
    return [
      { form: "block", annotation_type: "note", certainty: "neutral",
        scope: { kind: "sentence", value: 1 }, body: "note about alpha",
        date: null, is_structured: false,
        char_start: ANN1_START, char_end: ANN1_END,
        original: DOC.slice(ANN1_START, ANN1_END) },
      { form: "block", annotation_type: "note", certainty: "neutral",
        scope: { kind: "sentence", value: 1 }, body: "note about beta",
        date: null, is_structured: false,
        char_start: ANN2_START, char_end: ANN2_END,
        original: DOC.slice(ANN2_START, ANN2_END) },
    ];
  }

  function resolveScope(content, charStart, scope) {
    if (scope.kind === "sentence" && scope.value === 1) {
      const textBefore = content.slice(0, charStart).trimEnd();
      if (!textBefore.length) return null;
      const paragraphs = textBefore.split(/\\n\\n+/);
      const last = paragraphs[paragraphs.length - 1] ?? "";
      const end = textBefore.length;
      let start = end - last.length;
      while (start < end && /\\s/.test(content[start])) start++;
      return { start, end };
    }
    if (scope.kind === "anchor") {
      const textBefore = content.slice(0, charStart);
      const pos = textBefore.lastIndexOf(scope.value);
      if (pos === -1) return null;
      return { start: pos, end: pos + scope.value.length };
    }
    return null;
  }

  const callbacks = new Map();
  let callbackId = 0;
  const listeners = new Map();

  window.__TAURI_INTERNALS__ = {
    invoke: function (cmd, args) {
      if (cmd === "plugin:event|listen") {
        const id = callbackId++;
        listeners.set(args?.event || "unknown", id);
        return Promise.resolve(id);
      }
      if (cmd === "plugin:event|unlisten") return Promise.resolve();
      if (cmd === "parse_annotations") return Promise.resolve(parseAnnotations());
      if (cmd === "list_annotations") return Promise.resolve([]);
      if (cmd === "resolve_annotation_scope") {
        // Simulate real IPC latency.
        return new Promise((res) => {
          setTimeout(() => res(resolveScope(args.content, args.charStart, args.scope)), 60);
        });
      }
      if (cmd === "resolve_annotation_scope_with_mode") {
        return new Promise((res) => {
          setTimeout(() => res(resolveScope(args.content, args.charStart, args.scope)), 60);
        });
      }
      return Promise.resolve(null);
    },
    transformCallback: function (cb, once) {
      const id = callbackId++;
      callbacks.set(id, { cb, once: !!once });
      return id;
    },
    convertFileSrc: function (path) {
      return "asset://localhost/" + encodeURIComponent(path);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: function () {} };
})();`;

async function setup(page: Page) {
  await page.addInitScript(STUB);
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => window.__HOVER__?.ready === true, null, {
    timeout: 60_000,
  });
  await page.waitForTimeout(200);
}

test("hover 2nd block annotation highlights its scope (issue 1028)", async ({ page }) => {
  await setup(page);

  const s0 = await page.evaluate(() => window.__HOVER__.state());
  expect(s0.pillCount).toBe(2);

  const pills = page.locator(".cm-annotation-pill");
  await pills.nth(0).hover();
  await page.waitForTimeout(150);
  const s1 = await page.evaluate(() => window.__HOVER__.state());
  expect(s1.highlight).not.toBeNull();

  await pills.nth(1).hover();
  await page.waitForTimeout(150);
  const s2 = await page.evaluate(() => window.__HOVER__.state());
  expect(s2.highlight).not.toBeNull();
  expect(s2.domHighlights).toEqual(["Second term beta appears here."]);
});

test("widget rebuild while pointer is over the hovered pill keeps the highlight", async ({ page }) => {
  await setup(page);

  const pills = page.locator(".cm-annotation-pill");
  await pills.nth(1).hover();
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => window.__HOVER__.state());
  expect(before.highlight).not.toBeNull();

  // Enrichment-style rebuild (uuid added -> eq() false -> DOM replaced).
  await page.evaluate(() => window.__HOVER__.enrich());
  await page.waitForTimeout(150);

  const after = await page.evaluate(() => window.__HOVER__.state());
  expect(after.highlight).not.toBeNull();
  expect(after.domHighlights).toEqual(["Second term beta appears here."]);
});

test("same-value rebuild while hovering keeps the highlight (eq() true)", async ({ page }) => {
  await setup(page);

  const pills = page.locator(".cm-annotation-pill");
  await pills.nth(1).hover();
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => window.__HOVER__.state());
  expect(before.highlight).not.toBeNull();

  await page.evaluate(() => window.__HOVER__.rebuild());
  await page.waitForTimeout(150);

  const after = await page.evaluate(() => window.__HOVER__.state());
  expect(after.highlight).not.toBeNull();
});

test("fast pill1 -> pill2 move without pause ends on pill2's highlight", async ({ page }) => {
  await setup(page);

  const pills = page.locator(".cm-annotation-pill");
  // Continuous motion: enter pill1 then immediately slide to pill2 without
  // waiting for pill1's resolve to land (resolve is delayed 60ms in the stub).
  const b1 = await pills.nth(0).boundingBox();
  const b2 = await pills.nth(1).boundingBox();
  if (!b1 || !b2) throw new Error("pills missing");
  await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2);
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2, { steps: 12 });
  await page.waitForTimeout(250);

  const s = await page.evaluate(() => window.__HOVER__.state());
  expect(s.highlight).not.toBeNull();
  expect(s.domHighlights).toEqual(["Second term beta appears here."]);
});

test("hover pill2 while a rebuild is in-flight keeps highlight", async ({ page }) => {
  await setup(page);

  const pills = page.locator(".cm-annotation-pill");
  await pills.nth(1).hover();
  await page.waitForTimeout(100); // resolve (60ms) may or may not have landed

  // Rebuild (uuid enrichment) WHILE the resolve is possibly in flight.
  await page.evaluate(() => window.__HOVER__.enrich());
  await page.waitForTimeout(250);

  const s = await page.evaluate(() => window.__HOVER__.state());
  expect(s.highlight).not.toBeNull();
  expect(s.domHighlights).toEqual(["Second term beta appears here."]);
});

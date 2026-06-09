import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { CODE_EXTENSIONS } from "./useLeafFileType";

/**
 * Cross-language sync guard for the code-file extension list.
 *
 * The TS set `CODE_EXTENSIONS` (useLeafFileType.ts) and the canonical Rust
 * list `is_code_extension` (src-tauri/src/workspace/watcher.rs) MUST stay in
 * sync. `getFileType` runs synchronously during session restore (before the
 * authoritative async `file_type` from the pages list has loaded). If a future
 * Rust-side addition is missed in TS, `getFileType` falls through to
 * "markdown" for that extension, routing the file to EditorPane -> readPage,
 * which injects frontmatter YAML into the code file on first save and corrupts
 * it. This static test fails loudly the moment either side drifts.
 *
 * This is intentionally NOT an IPC/Tauri command: a runtime async lookup would
 * not be available in time for the synchronous restore path; the guarantee
 * must be a build-time/static check.
 */
describe("code-extension list stays in sync with Rust", () => {
  const rustSource = readFileSync(
    resolve(__dirname, "../../src-tauri/src/workspace/watcher.rs"),
    "utf-8",
  );

  // Isolate the `is_code_extension` match arm body: slice from the fn
  // signature to the first `)` that closes the `matches!` invocation.
  const fnStart = rustSource.indexOf("pub(crate) fn is_code_extension");
  const matchesStart = rustSource.indexOf("matches!", fnStart);
  const matchesEnd = rustSource.indexOf(")", matchesStart);
  const armBody = rustSource.slice(matchesStart, matchesEnd);

  // Extract every double-quoted lowercase token in the match arm.
  const rustExtensions = [...armBody.matchAll(/"([a-z0-9]+)"/g)].map(
    (m) => m[1],
  );
  const rustSet = new Set(rustExtensions);

  it("extracts a non-empty Rust extension list (guards against parse miss)", () => {
    expect(fnStart).toBeGreaterThanOrEqual(0);
    expect(matchesStart).toBeGreaterThanOrEqual(0);
    expect(rustSet.size).toBeGreaterThan(0);
  });

  it("has matching counts (catches both add and remove drift)", () => {
    expect(rustSet.size).toBe(CODE_EXTENSIONS.size);
  });

  it("TS CODE_EXTENSIONS deep-equals the canonical Rust list", () => {
    expect([...CODE_EXTENSIONS].sort()).toEqual([...rustSet].sort());
  });
});

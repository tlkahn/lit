import { usePaneStore, findLeaf } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import type { PageMeta } from "../lib/ipc";

export type LeafFileType = "pdf" | "markdown" | "code";

// Single frontend source of truth for code-file extensions. MUST stay
// byte-for-byte in sync with the two Rust definitions:
//   - src-tauri/src/workspace/scan.rs (extension match arm)
//   - src-tauri/src/workspace/watcher.rs::is_code_extension
// Any add/remove must touch all three. Matching is case-SENSITIVE (the Rust
// scanner/watcher match extensions case-sensitively), so uppercase variants
// like `.RS`/`.BIB` are intentionally NOT recognized as code. (.txt is
// intentionally excluded.)
const CODE_EXTENSIONS = new Set([
  "bib",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
  "py",
  "rs",
  "json",
  "yaml",
  "yml",
  "toml",
  "html",
  "htm",
  "css",
  "sh",
  "bash",
  "zsh",
]);

/**
 * Derive a leaf's file type from the workspace pages list by matching its
 * `pagePath` against `relative_path`.
 *
 * Returns `null` only when `pagePath` is null (an empty pane). When the pages
 * list has not loaded yet (no matching meta), falls back to sniffing the
 * extension: a `.pdf` path resolves to `"pdf"` so the leaf routes straight to
 * the PDF viewer instead of flashing the markdown editor (which would run
 * `readPage` on a binary file); a known code extension resolves to `"code"` so
 * a restored code leaf routes straight to the code editor (instead of flashing
 * EditorPane, which would run `readPage` and corrupt the file via frontmatter);
 * everything else resolves to `"markdown"`, the documented fallback. Once the
 * real meta arrives the leaf re-renders with the authoritative type.
 *
 * The `.pdf` sniff is case-insensitive (preserving existing behavior), but the
 * code-extension sniff is case-SENSITIVE to match the Rust scanner/watcher:
 * uppercase `.RS`/`.BIB` are not recognized as code.
 */
export function getFileType(
  pagePath: string | null,
  pages: PageMeta[],
): LeafFileType | null {
  if (pagePath == null) return null;
  const known = pages.find((p) => p.relative_path === pagePath)?.file_type;
  if (known != null) return known;
  if (pagePath.toLowerCase().endsWith(".pdf")) return "pdf";
  const dot = pagePath.lastIndexOf(".");
  if (dot >= 0) {
    const ext = pagePath.slice(dot + 1);
    if (CODE_EXTENSIONS.has(ext)) return "code";
  }
  return "markdown";
}

export function useLeafFileType(paneId: string | null): LeafFileType | null {
  const pagePath = usePaneStore((s) =>
    paneId == null ? null : findLeaf(s.root, paneId)?.pagePath ?? null,
  );
  const pages = useWorkspaceStore((s) => s.pages);
  return getFileType(pagePath, pages);
}

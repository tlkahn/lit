export function resolveRelativePath(base: string, relative: string): string {
  const segments = (base ? base + "/" + relative : relative).split("/");
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === "..") resolved.pop();
    else if (seg !== "." && seg !== "") resolved.push(seg);
  }
  return resolved.join("/");
}

export function getFileDir(pagePath: string | null): string | null {
  if (pagePath === null) return null;
  const lastSlash = pagePath.lastIndexOf("/");
  return lastSlash >= 0 ? pagePath.substring(0, lastSlash) : "";
}

/**
 * Detect paths that should NOT be resolved relative to a base directory.
 * Covers Unix absolute (/...), home-relative (~/...), and Windows drive letters (C:\...).
 */
export function isAbsolutePath(path: string): boolean {
  return /^\/|^~\/|^~$|^[A-Za-z]:[\\/]|^\\\\/.test(path);
}

/**
 * Returns true for absolute path forms that the pane layer can actually open:
 * currently only Unix absolute paths (starting with `/`).
 * Tilde paths, Windows drive letters, and UNC paths are "absolute" but cannot
 * be rendered by PdfViewerPane/EditorPane without expansion/translation, so
 * they return false here.
 */
export function isOpenablePath(path: string): boolean {
  return path.startsWith("/");
}

/**
 * Compute ancestor folder paths for a given relative file path.
 * Normalizes the input by filtering empty segments (from leading/trailing/
 * consecutive slashes) so that e.g. "/docs/readme.md" produces ["docs"],
 * matching the folder-key convention used by buildRows.
 */
export function getAncestorPaths(relativePath: string): string[] {
  const parts = relativePath.split("/").filter((seg) => seg !== "");
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join("/"));
  }
  return ancestors;
}

export function frontmatterLineCount(rawYaml: string): number {
  if (!rawYaml) return 0;
  return rawYaml.trimEnd().split("\n").length + 2;
}

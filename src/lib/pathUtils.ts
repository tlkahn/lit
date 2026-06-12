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
  return /^\/|^~\/|^~$|^[A-Za-z]:[\\/]/.test(path);
}

export function frontmatterLineCount(rawYaml: string): number {
  if (!rawYaml) return 0;
  return rawYaml.trimEnd().split("\n").length + 2;
}

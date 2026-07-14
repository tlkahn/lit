import { resolveRelativePath } from "./pathUtils";

/**
 * Where a markdown-embedded file link (`[text](path)`) should go.
 * - `page`: vault-internal markdown — open in-app. `target` is the
 *   workspace-relative path with the `.md` extension stripped (the wikilink
 *   resolver's tier-1 input); `section` carries the `#fragment`, if any.
 * - `os`: hand off to the OS opener. `absPath` has a leading slash.
 * - `none`: unroutable (relative link with no note directory context).
 */
export type LinkRoute =
  | { kind: "page"; target: string; section?: string }
  | { kind: "os"; absPath: string }
  | { kind: "none" };

export function routeFileLink(
  path: string,
  fragment: string | null,
  noteDir: string,
  workspacePath: string,
): LinkRoute {
  let resolved: string;
  if (path.startsWith("/")) {
    resolved = resolveRelativePath("", path);
  } else {
    if (!noteDir) return { kind: "none" };
    resolved = resolveRelativePath(noteDir, path);
  }
  // Normalize to the slash-less absolute convention used throughout resolution.
  const ws = resolveRelativePath("", workspacePath);
  if (ws && resolved.startsWith(ws + "/") && /\.md$/i.test(resolved)) {
    const target = resolved.slice(ws.length + 1).replace(/\.md$/i, "");
    return fragment ? { kind: "page", target, section: fragment } : { kind: "page", target };
  }
  return { kind: "os", absPath: "/" + resolved };
}

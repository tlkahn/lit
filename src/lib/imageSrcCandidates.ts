// Keep in sync with DEFAULT_IMAGE_DIR in src-tauri/src/commands/academic_export.rs
export const DEFAULT_IMAGE_DIR = "assets/images";

import { isAbsolutePath, resolveRelativePath } from "./pathUtils";

function resolveAgainst(base: string, rel: string): string {
  const wasAbsolute = base.startsWith("/");
  const result = resolveRelativePath(base, rel);
  return wasAbsolute && !result.startsWith("/") ? "/" + result : result;
}

export function isNakedImagePath(src: string): boolean {
  if (/^(https?:|data:|blob:)/.test(src)) return false;
  if (isAbsolutePath(src)) return false;
  if (src.startsWith("./") || src.startsWith("../")) return false;
  return true;
}

export function resolveImageDirBase(
  imageDir: string,
  noteDir: string,
  workspacePath: string,
): string {
  const trimmed = imageDir.replace(/\/+$/, "");
  if (!trimmed) return workspacePath;
  if (trimmed.startsWith("/")) return trimmed;
  if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return resolveAgainst(noteDir, trimmed);
  }
  return workspacePath ? workspacePath + "/" + trimmed : trimmed;
}

export interface ImageSrcCandidatesOpts {
  src: string;
  noteDir: string;
  workspacePath: string;
  imageDir: string;
}

export function imageSrcCandidates(opts: ImageSrcCandidatesOpts): string[] {
  const { src, noteDir, workspacePath, imageDir } = opts;

  if (/^(https?:|data:|blob:)/.test(src)) return [src];

  const primary = noteDir ? resolveAgainst(noteDir, src) : src;

  if (!isNakedImagePath(src)) return [primary];

  if (!workspacePath) return [primary];

  const trimmedDir = imageDir.replace(/\/+$/, "");
  if (trimmedDir && src.startsWith(trimmedDir + "/")) return [primary];

  const base = resolveImageDirBase(imageDir, noteDir, workspacePath);
  const fallback = base + "/" + src;

  if (fallback === primary) return [primary];

  return [primary, fallback];
}

type FrontmatterPatchHandler = (
  pagePath: string,
  patch: Record<string, unknown>,
) => void;

const handlers = new Map<string, FrontmatterPatchHandler>();

export function onFrontmatterPatch(
  pagePath: string,
  handler: FrontmatterPatchHandler,
): () => void {
  handlers.set(pagePath, handler);
  return () => {
    if (handlers.get(pagePath) === handler) handlers.delete(pagePath);
  };
}

export function emitFrontmatterPatch(
  pagePath: string,
  patch: Record<string, unknown>,
): void {
  handlers.get(pagePath)?.(pagePath, patch);
}

export function _resetForTesting(): void {
  handlers.clear();
}

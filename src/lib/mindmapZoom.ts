export interface ZoomTransformLike {
  k: number;
  x: number;
  y: number;
}

export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export function invertPoint(
  screenX: number,
  screenY: number,
  transform: ZoomTransformLike,
): { x: number; y: number } {
  return {
    x: (screenX - transform.x) / transform.k,
    y: (screenY - transform.y) / transform.k,
  };
}

export function computeFitTransform(
  contentBounds: ContentBounds,
  viewport: Viewport,
  padding = 20,
): ZoomTransformLike {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return { k: 1, x: 0, y: 0 };
  }
  if (contentBounds.width <= 0 || contentBounds.height <= 0) {
    return { k: 1, x: 0, y: 0 };
  }

  const availW = viewport.width - 2 * padding;
  const availH = viewport.height - 2 * padding;
  const k = Math.min(1, availW / contentBounds.width, availH / contentBounds.height);

  const cx = contentBounds.x + contentBounds.width / 2;
  const cy = contentBounds.y + contentBounds.height / 2;

  return {
    k,
    x: viewport.width / 2 - k * cx,
    y: viewport.height / 2 - k * cy,
  };
}

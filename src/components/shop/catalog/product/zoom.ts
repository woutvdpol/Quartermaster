/**
 * Pan/zoom math for the product lightbox. Pure, so it is unit-tested without a DOM.
 * The view is `transform: translate(x, y) scale(scale)` with `transform-origin: center`; points are
 * measured relative to the container centre.
 */

export type ZoomState = { scale: number; x: number; y: number };

export const MIN_SCALE = 1;
export const MAX_SCALE = 6;
export const IDENTITY: ZoomState = { scale: 1, x: 0, y: 0 };

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Keeps the scaled content covering the container (no empty gutters beyond the image edges). */
export function clampPan(s: ZoomState, box: { width: number; height: number }): ZoomState {
  const maxX = ((s.scale - 1) * box.width) / 2;
  const maxY = ((s.scale - 1) * box.height) / 2;
  return { scale: s.scale, x: clamp(s.x, -maxX, maxX), y: clamp(s.y, -maxY, maxY) };
}

/** Zooms to `nextScale` keeping the content point under `p` (relative to the centre) fixed. */
export function zoomAt(s: ZoomState, nextScale: number, p: { x: number; y: number }, box: { width: number; height: number }): ZoomState {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  if (scale === MIN_SCALE) return IDENTITY;
  const k = scale / s.scale;
  return clampPan({ scale, x: p.x - (p.x - s.x) * k, y: p.y - (p.y - s.y) * k }, box);
}

export function panBy(s: ZoomState, dx: number, dy: number, box: { width: number; height: number }): ZoomState {
  if (s.scale <= MIN_SCALE) return IDENTITY;
  return clampPan({ scale: s.scale, x: s.x + dx, y: s.y + dy }, box);
}
